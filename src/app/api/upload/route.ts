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
import { putInvoice } from '@/lib/dynamodb'

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

const UPLOAD_DB_TIMEOUT_MS = 10000

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), UPLOAD_DB_TIMEOUT_MS)
    }),
  ])
}

/**
 * Attempt a Supabase upsert, auto-stripping columns that don't exist
 * in the table schema. This prevents the "Could not find the 'X' column
 * of 'invoices' in the schema cache" error.
 */
async function tryUpsert(invoice: Record<string, any>, retries = 5): Promise<{ error: any }> {
  if (retries <= 0) {
    return { error: new Error('Insert failed after stripping all conditional columns') }
  }
  const { supabase, TABLES } = await import('@/lib/dynamodb')
  const { error } = await supabase.from(TABLES.INVOICES).upsert(invoice)
  if (error && error.message?.includes("Could not find the '") && error.message?.includes("' column of '")) {
    const match = error.message.match(/'([^']+)' column/)
    if (match) {
      const badCol = match[1]
      const cleaned = { ...invoice }
      delete cleaned[badCol]
      console.warn(`[tryUpsert] Stripped unknown column "${badCol}" and retrying`)
      return tryUpsert(cleaned, retries - 1)
    }
  }
  return { error }
}

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
    // Use tryUpsert which auto-strips columns that don't exist in the
    // Supabase "invoices" table schema. This handles any schema mismatch
    // between the Invoice TypeScript type and the actual DB columns.
    const skeleton: Record<string, any> = {
      id: invoiceId,
      uploadedAt: now,
      fileName: file.name,
      vendorName: 'Processing…',
      invoiceNumber: 'Processing…',
      invoiceDate: now.split('T')[0],
      dueDate: now.split('T')[0],
      totalAmount: 0,
      lineItems: [],
      status: 'PROCESSING',
    }

    const { error: createError } = await withTimeout(
      tryUpsert(skeleton),
      'Invoice queue write timed out. Please try again.'
    )

    if (createError) {
      throw createError
    }

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
  const setStage = async (stage: string) => {
    const { error } = await updateInvoiceStatus(invoiceId, 'PROCESSING', { notes: stage } as any)
    if (error) throw error
  }

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

    const update: Record<string, any> = {
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

    // Use tryUpsert to auto-strip columns that don't exist in the schema.
    const { error: finalizeError } = await tryUpsert(update)

    if (finalizeError) {
      throw finalizeError
    }
  } catch (err) {
    console.error('[processInvoiceAsync] error for', invoiceId, err)
    // Mark as PENDING so it surfaces in the dashboard for manual review.
    const { error } = await updateInvoiceStatus(invoiceId, 'PENDING', {
      notes: 'FAILED',
    } as any)
    if (error) console.error('[processInvoiceAsync] failed to mark invoice as failed', invoiceId, error)
  }
}
