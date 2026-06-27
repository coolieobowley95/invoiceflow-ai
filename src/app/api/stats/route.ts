import { NextResponse } from 'next/server'
import { listInvoices } from '@/lib/dynamodb'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const all = await listInvoices()

    const stats = {
      total: all.length,
      pending: all.filter(i => i.status === 'PENDING').length,
      processing: all.filter(i => i.status === 'PROCESSING').length,
      matched: all.filter(i => i.status === 'MATCHED').length,
      discrepancy: all.filter(i => i.status === 'DISCREPANCY').length,
      approved: all.filter(i => i.status === 'APPROVED').length,
      rejected: all.filter(i => i.status === 'REJECTED').length,
      paid: all.filter(i => i.status === 'PAID').length,
      totalValue: all.reduce((sum, i) => sum + (i.totalAmount || 0), 0),
      approvedValue: all
        .filter(i => ['APPROVED', 'PAID'].includes(i.status))
        .reduce((sum, i) => sum + (i.totalAmount || 0), 0),
      avgConfidence: all.length
        ? all.reduce((sum, i) => sum + (i.aiConfidence || 0), 0) / all.length
        : 0,
      straightThroughRate: all.length
        ? all.filter(i => i.status === 'MATCHED' || i.status === 'APPROVED' || i.status === 'PAID').length / all.length
        : 0,
    }

    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}