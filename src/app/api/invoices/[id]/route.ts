import { NextRequest, NextResponse } from 'next/server'
import { getInvoice, updateInvoiceStatus, InvoiceStatus } from '@/lib/dynamodb'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoice = await getInvoice(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { status, approvedBy, rejectedReason, notes } = body

    if (!status) return NextResponse.json({ error: 'status required' }, { status: 400 })

    const validTransitions: Record<string, InvoiceStatus[]> = {
      MATCHED: ['APPROVED', 'REJECTED'],
      DISCREPANCY: ['APPROVED', 'REJECTED'],
      PENDING: ['APPROVED', 'REJECTED'],
    }

    const invoice = await getInvoice(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const allowed = validTransitions[invoice.status] || []
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${invoice.status} to ${status}` },
        { status: 400 }
      )
    }

    const extra: Record<string, unknown> = {}
    if (status === 'APPROVED') {
      extra.approvedBy = approvedBy || 'system'
      extra.approvedAt = new Date().toISOString()
    }
    if (status === 'REJECTED' && rejectedReason) {
      extra.rejectedReason = rejectedReason
    }
    if (notes) extra.notes = notes

    await updateInvoiceStatus(params.id, status, extra as any)
    return NextResponse.json({ success: true, status })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
