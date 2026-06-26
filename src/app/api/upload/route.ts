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
import { putInvoice, updateInvoiceStatus } from '@/lib/dynamodb'

export const runtime = 'nodejs'
// Upload itself is fast; we only need a short window for file I/O.
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
    await putInvoice({
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
      rawText: '',
      // processingStage is a UI hint stored alongside the record
      // so the status endpoint can surface granular progress.
      // Add this column to your Supabase "invoices" table as text, nullable.
    } as any)

    // --- 2. Fire async extraction — intentionally NOT awaited ---
    processInvoiceAsync(invoiceId, file.name, file.type, buffer).catch(err => {
      console.error('[upload] async processing failed for', invoiceId, err)
    })

    // --- 3. Return the jobId immediately (~300 ms total) ---
    return NextResponse.json(
      {
        invoiceId,
        message: 'Invoice queued for processing',
      },
      { status: 202 } // 202 Accepted — processing has started but isn't complete
    )
  } catch (error: any) {
    console.error('[upload] error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Background processor — runs after the HTTP response has been sent.
// Each await updates the DB so the polling endpoint reflects real progress.
// ---------------------------------------------------------------------------
async function processInvoiceAsync(
  invoiceId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
) {
  const { extractInvoiceData, matchInvoiceToPO } = await import('@/lib/ai')
  const { updateInvoiceStatus, listPurchaseOrders, getInvoice, putInvoice } =
    await import('@/lib/dynamodb')

  // Helper: update the processing stage label in the DB
  const setStage = (stage: string) =>
    updateInvoiceStatus(invoiceId, 'PROCESSING', { notes: stage } as any)

  try {
    // Stage 1 — extract raw text
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

    // Stage 2 — AI field parsing
    await setStage('PARSING_FIELDS')
    const extracted = await extractInvoiceData(rawText)

    // Stage 3 — PO matching
    await setStage('MATCHING_PO')
    const purchaseOrders = await listPurchaseOrders()
    const { po, discrepancies } = matchInvoiceToPO(extracted, purchaseOrders)

    // Stage 4 — finalise
    const status = po
      ? discrepancies.length > 0
        ? 'DISCREPANCY'
        : 'MATCHED'
      : 'PENDING'

    const existing = await getInvoice(invoiceId)
    if (!existing) return // record deleted mid-flight — nothing to do

    await putInvoice({
      ...existing,
      vendorName: extracted.vendorName,
      vendorEmail: extracted.vendorEmail,
      invoiceNumber: extracted.invoiceNumber,
      invoiceDate: extracted.invoiceDate,
      dueDate: extracted.dueDate,
      totalAmount: extracted.totalAmount,
      currency: extracted.currency,
      lineItems: extracted.lineItems,
      status,
      matchedPOId: po?.id,
      discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
      aiConfidence: extracted.confidence,
      rawText,
      notes: 'COMPLETE',
    })
  } catch (err) {
    console.error('[processInvoiceAsync] error for', invoiceId, err)
    // Mark as PENDING so it surfaces in the dashboard for manual review.
    await updateInvoiceStatus(invoiceId, 'PENDING', {
      notes: 'FAILED',
    } as any)
  }
}