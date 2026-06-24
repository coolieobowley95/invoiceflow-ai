import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { putInvoice } from '@/lib/dynamodb'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff']
    if (!validTypes.some(t => file.type.startsWith(t.split('/')[0]) || file.type === t)) {
      return NextResponse.json({ error: 'Invalid file type. PDF or image required.' }, { status: 400 })
    }

    const invoiceId = uuidv4()
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Extract text based on file type
    let rawText = ''
    if (file.type === 'application/pdf') {
      try {
        const pdfParse = require('pdf-parse')
        const data = await pdfParse(buffer)
        rawText = data.text
      } catch {
        rawText = `PDF file: ${file.name} (text extraction unavailable in demo)`
      }
    } else {
      // For images — in production, use AWS Textract or similar
      rawText = `Image invoice: ${file.name}. Amount: $12,500.00. Vendor: Acme Software Solutions. Invoice #INV-2026-${Math.floor(Math.random() * 9000) + 1000}.`
    }

    // Create a PENDING invoice record immediately
    const now = new Date().toISOString()
    await putInvoice({
      id: invoiceId,
      uploadedAt: now,
      fileName: file.name,
      vendorName: 'Processing...',
      invoiceNumber: 'Processing...',
      invoiceDate: now.split('T')[0],
      dueDate: now.split('T')[0],
      totalAmount: 0,
      currency: 'USD',
      lineItems: [],
      status: 'PROCESSING',
      aiConfidence: 0,
      rawText,
    })

    // Kick off async processing (don't await — return invoiceId immediately)
    processInvoiceAsync(invoiceId, rawText).catch(console.error)

    return NextResponse.json({ invoiceId, message: 'Invoice uploaded and queued for processing' })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}

async function processInvoiceAsync(invoiceId: string, rawText: string) {
  const { extractInvoiceData, matchInvoiceToPO } = await import('@/lib/ai')
  const { updateInvoiceStatus, listPurchaseOrders, putInvoice, getInvoice } = await import('@/lib/dynamodb')

  try {
    // Extract invoice data with AI
    const extracted = await extractInvoiceData(rawText)

    // Load purchase orders and attempt matching
    const purchaseOrders = await listPurchaseOrders()
    const { po, discrepancies } = matchInvoiceToPO(extracted, purchaseOrders)

    const status = po
      ? discrepancies.length > 0 ? 'DISCREPANCY' : 'MATCHED'
      : 'PENDING'

    // Update the invoice with extracted data
    const existing = await getInvoice(invoiceId)
    if (!existing) return

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
    })
  } catch (error) {
    console.error('Processing error for', invoiceId, error)
    await updateInvoiceStatus(invoiceId, 'PENDING')
  }
}
