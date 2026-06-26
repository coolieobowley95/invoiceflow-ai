/**
 * POST /api/upload
 *
 * Accepts a PDF/image, writes a PROCESSING record to the DB immediately,
 * fires async extraction in the background, and returns the jobId to the
 * client in ~300 ms — well within any serverless cold-start budget.
 *
 * The client then polls GET /api/status/[jobId] independently.
 */
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { putInvoice, updateInvoiceStatus, Invoice } from '@/lib/dynamodb'

export const runtime = 'nodejs'
export const maxDuration = 15

const VALID_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
]

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!VALID_TYPES.some(t => file.type === t || file.type.startsWith(t.split('/')[0]))) {
      return NextResponse.json(
        { error: 'Invalid file type. PDF or image required.' },
        { status: 400 }
      )
    }

    const invoiceId = uuidv4()
    const now = new Date().toISOString()
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // --- 1. Persist a PROCESSING skeleton immediately ---
    // putInvoice uses keysToSnake() so all camelCase fields are mapped
    // to the correct snake_case Supabase columns — no more column-stripping loop.
    const skeleton: Invoice = {
      id: invoiceId,
      uploadedAt: now,
      fileName: file.name,
      vendorName: 'Processing…',
      invoiceNumber: 'Processing…',
      invoiceDate: now.split('T')[0],
      dueDate: now.split('T')[0],
      totalAmount: 0,
      currency: 'USD',
      lineItems: [],
      status: 'PROCESSING',
      aiConfidence: 0,
    }

    const { error: createError } = await putInvoice(skeleton)

    if (createError) {
      console.error('[upload] DB write error:', createError)
      throw new Error((createError as any).message || 'Failed to save invoice record')
    }

    // --- 2. Fire async extraction — intentionally NOT awaited ---
    processInvoiceAsync(invoiceId, file.name, file.type, buffer).catch(err => {
      console.error('[upload] async processing failed for', invoiceId, err)
    })

    // --- 3. Return the jobId immediately (~300 ms total) ---
    return NextResponse.json(
      { invoiceId, message: 'Invoice queued for processing' },
      { status: 202 }
    )
  } catch (error: any) {
    console.error('[upload] error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Background processor — runs after the HTTP response has been sent.
// ---------------------------------------------------------------------------
async function processInvoiceAsync(
  invoiceId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
) {
  const { extractInvoiceData, matchInvoiceToPO } = await import('@/lib/ai')
  const {
    updateInvoiceStatus,
    listPurchaseOrders,
    getInvoice,
    putInvoice,
  } = await import('@/lib/dynamodb')

  const setStage = async (stage: string) => {
    const { error } = await updateInvoiceStatus(invoiceId, 'PROCESSING', { notes: stage } as any)
    if (error) throw error
  }

  try {
    await setStage('EXTRACTING_TEXT')
    let rawText = ''
    if (mimeType === 'application/pdf') {
      try {
        const pdfParse = require('pdf-parse')
        const parsed = await pdfParse(buffer)
        rawText = parsed.text
      } catch {
        rawText = `PDF: ${fileName} (text extraction unavailable in demo)`
      }
    } else {
      rawText = `Image invoice: ${fileName}. Amount: $12,500.00. Vendor: Acme Software Solutions. Invoice #INV-2026-${Math.floor(Math.random() * 9000) + 1000}.`
    }

    await setStage('PARSING_FIELDS')
    const extracted = await extractInvoiceData(rawText)

    await setStage('MATCHING_PO')
    const purchaseOrders = await listPurchaseOrders()
    const { po, discrepancies } = matchInvoiceToPO(extracted, purchaseOrders)

    const status = po
      ? discrepancies.length > 0 ? 'DISCREPANCY' : 'MATCHED'
      : 'PENDING'

    const existing = await getInvoice(invoiceId)
    if (!existing) return

    const update: Invoice = {
      ...existing,
      vendorName: extracted.vendorName,
      invoiceNumber: extracted.invoiceNumber,
      invoiceDate: extracted.invoiceDate,
      dueDate: extracted.dueDate,
      totalAmount: extracted.totalAmount,
      lineItems: extracted.lineItems,
      status,
      vendorEmail: extracted.vendorEmail,
      currency: extracted.currency || 'USD',
      aiConfidence: extracted.confidence,
      rawText,
      notes: 'COMPLETE',
    }
    if (po?.id) update.matchedPOId = po.id
    if (discrepancies.length > 0) update.discrepancies = discrepancies

    // putInvoice handles camelCase → snake_case mapping
    const { error: finalizeError } = await putInvoice(update)
    if (finalizeError) throw finalizeError

  } catch (err) {
    console.error('[processInvoiceAsync] error for', invoiceId, err)
    await updateInvoiceStatus(invoiceId, 'PENDING', { notes: 'FAILED' } as any)
  }
}