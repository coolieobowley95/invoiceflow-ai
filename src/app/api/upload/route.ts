import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { putInvoice, updateInvoiceStatus, Invoice, listPurchaseOrders } from '@/lib/dynamodb'
import { extractInvoiceData, matchInvoiceToPO } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60

const VALID_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
]

export async function POST(req: NextRequest) {
  const invoiceId = uuidv4()
  const now = new Date().toISOString()

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

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 1. Save skeleton immediately so dashboard shows it right away
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

    // 2. Send file buffer directly to Gemini vision — works for both PDFs and images
    console.log('[upload] sending to Gemini vision, file type:', file.type, 'size:', file.size)
    const extracted = await extractInvoiceData(buffer, file.type)
    console.log('[upload] Gemini extracted:', JSON.stringify(extracted))

    // 3. Match against purchase orders
    const purchaseOrders = await listPurchaseOrders()
    const { po, discrepancies } = matchInvoiceToPO(extracted, purchaseOrders)

    const status = po
      ? discrepancies.length > 0 ? 'DISCREPANCY' : 'MATCHED'
      : 'PENDING'

    // 4. Save final result with all extracted data
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

    return NextResponse.json({ invoiceId, message: 'Invoice processed' }, { status: 200 })

  } catch (error: any) {
    console.error('[upload] fatal error:', error)
    await updateInvoiceStatus(invoiceId, 'PENDING', { notes: 'FAILED' } as any).catch(() => {})
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}
