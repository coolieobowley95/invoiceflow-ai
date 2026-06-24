import { NextRequest, NextResponse } from 'next/server'
import { listInvoices } from '@/lib/dynamodb'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as any
    const invoices = await listInvoices(status || undefined)
    return NextResponse.json(invoices)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
