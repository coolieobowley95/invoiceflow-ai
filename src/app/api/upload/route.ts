import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { putInvoice, updateInvoiceStatus, Invoice, listPurchaseOrders } from '@/lib/dynamodb'
import { extractInvoiceData, extractInvoiceDataFromImage, matchInvoiceToPO } from '@/lib/ai'
import { sendInvoiceToSlack, sendFailureNotification } from '@/lib/slack'

export const runtime = 'nodejs'
export const maxDuration = 60

const VALID_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
]

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff']

export async function POST(req: NextRequest) {
  const invoiceId = uuidv4()
  const now = new Date().toISOString()

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!VALID_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. PDF or image required.' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 1. Save skeleton immediately so dashboard shows it straight away
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
      throw new Error((createError as any).message || 'Failed to save invoice record')
    }

    // 2. Extract invoice data
    // Images → vision model (reads actual content)
    // PDFs  → text extraction then Groq
    let extracted

    const isImage = IMAGE_TYPES.includes(file.type)

    if (isImage) {
      console.log('[upload] image invoice — using vision extraction:', file.type)
      const imageBase64 = buffer.toString('base64')
      extracted = await extractInvoiceDataFromImage(imageBase64, file.type, file.name)

    } else {
      let rawText = ''

      try {
        const pdfParse = require('pdf-parse')
        const parsed = await pdfParse(buffer)
        rawText = parsed.text?.trim() || ''
        console.log('[upload] pdf-parse extracted length:', rawText.length)
        if (rawText.length > 0) {
          console.log('[upload] pdf text preview:', rawText.slice(0, 300))
        }
      } catch (err) {
        console.error('[upload] pdf-parse error:', err)
        rawText = ''
      }

      if (!rawText || rawText.length < 20) {
        const namePart = file.name
          .replace(/\.pdf$/i, '')
          .replace(/[-_]/g, ' ')
        rawText = `Invoice PDF. Filename: ${namePart}. File size: ${file.size} bytes. No text layer found — may be a scanned document.`
        console.log('[upload] using filename hint:', rawText)
      }

      console.log('[upload] sending to AI, text length:', rawText.length)
      extracted = await extractInvoiceData(rawText)
    }

    console.log('[upload] AI extracted:', JSON.stringify(extracted))

    // 3. Match against purchase orders
    const purchaseOrders = await listPurchaseOrders()
    const { po, discrepancies } = matchInvoiceToPO(extracted, purchaseOrders)

    const status = po
      ? discrepancies.length > 0 ? 'DISCREPANCY' : 'MATCHED'
      : 'PENDING'

    // 4. Save final record with all extracted data
    const final: Invoice = {
      id: invoiceId,
      uploadedAt: now,
      fileName: file.name,
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
      notes: 'COMPLETE',
      ...(po?.id ? { matchedPOId: po.id } : {}),
      ...(discrepancies.length > 0 ? { discrepancies } : {}),
    }

    const { error: finalError } = await putInvoice(final)
    if (finalError) throw new Error((finalError as any).message)

    // 5. Send Slack approval request with RTS vendor history
    // Fire-and-forget — Slack failure must never fail the upload
    sendInvoiceToSlack(final).catch((err) => {
      console.error('[upload] Slack notification failed (non-fatal):', err?.message)
    })

    return NextResponse.json({ invoiceId, message: 'Invoice processed' }, { status: 200 })

  } catch (error: any) {
    console.error('[upload] fatal error:', error)

    // Mark the record as failed
    await updateInvoiceStatus(invoiceId, 'PENDING', { notes: 'FAILED' } as any).catch(() => {})

    // Notify Slack so the team knows something went wrong
    sendFailureNotification(invoiceId, error?.message || 'Unknown error').catch(() => {})

    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}