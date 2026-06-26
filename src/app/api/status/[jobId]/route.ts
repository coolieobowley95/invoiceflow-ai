/**
 * GET /api/status/[jobId]
 *
 * Lightweight polling endpoint. Returns the current processing stage
 * and final status of an invoice job. Designed for sub-100 ms response
 * times — it is only a DB read, never triggers any processing itself.
 *
 * Response shape:
 * {
 *   jobId: string
 *   status: InvoiceStatus          // DB-level status
 *   stage: ProcessingStage         // granular UI hint
 *   isTerminal: boolean            // true when polling should stop
 *   invoiceNumber?: string         // populated once extraction completes
 *   vendorName?: string
 *   totalAmount?: number
 *   currency?: string
 *   aiConfidence?: number
 *   error?: string
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getInvoice } from '@/lib/dynamodb'

export const runtime = 'nodejs'
export const maxDuration = 10

// The set of stages the background processor writes into `notes`.
// Keeping them as a const union makes the client easy to type.
export type ProcessingStage =
  | 'QUEUED'
  | 'EXTRACTING_TEXT'
  | 'PARSING_FIELDS'
  | 'MATCHING_PO'
  | 'COMPLETE'
  | 'FAILED'

// Statuses that mean the job has finished (success or failure).
const TERMINAL_STATUSES = new Set(['MATCHED', 'DISCREPANCY', 'APPROVED', 'REJECTED', 'PAID', 'PENDING'])
const TERMINAL_NOTES    = new Set(['COMPLETE', 'FAILED'])

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  try {
    const invoice = await getInvoice(jobId)

    if (!invoice) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const notes    = (invoice as any).notes as string | undefined
    const stage    = (notes as ProcessingStage) ?? 'QUEUED'
    const isTerminal =
      TERMINAL_STATUSES.has(invoice.status) || TERMINAL_NOTES.has(notes ?? '')

    return NextResponse.json(
      {
        jobId,
        status:       invoice.status,
        stage,
        isTerminal,
        ...(isTerminal && notes !== 'FAILED'
          ? {
              invoiceNumber: invoice.invoiceNumber,
              vendorName:    invoice.vendorName,
              totalAmount:   invoice.totalAmount,
              currency:      invoice.currency,
              aiConfidence:  invoice.aiConfidence,
              matchedPOId:   invoice.matchedPOId,
              discrepancies: invoice.discrepancies,
            }
          : {}),
        ...(notes === 'FAILED' ? { error: 'AI processing failed. Invoice queued for manual review.' } : {}),
      },
      {
        // Short cache: safe for CDN edge, keeps polling snappy
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch (err: any) {
    console.error('[status] error for', jobId, err)
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}