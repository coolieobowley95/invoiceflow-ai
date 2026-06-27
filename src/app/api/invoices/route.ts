import { NextRequest, NextResponse } from 'next/server'
import { listInvoices } from '@/lib/dynamodb'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as any
    const invoices = await listInvoices(status || undefined)
    return NextResponse.json(invoices, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}