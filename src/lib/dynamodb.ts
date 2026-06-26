import { createClient } from "@supabase/supabase-js"


export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)


export const TABLES = {
  INVOICES: "invoices",
  PURCHASE_ORDERS: "purchase_orders",
}


export type InvoiceStatus =
  | "PENDING"
  | "PROCESSING"
  | "MATCHED"
  | "DISCREPANCY"
  | "APPROVED"
  | "REJECTED"
  | "PAID"


// Shared invoice line item type
export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  total: number
}


// Discrepancy type
export interface Discrepancy {
  field: string
  invoiceValue: string | number
  poValue: string | number
  severity: "LOW" | "MEDIUM" | "HIGH"
}


// Invoice type
export interface Invoice {

  id: string

  uploadedAt: string

  fileName: string

  vendorName: string

  vendorEmail?: string

  invoiceNumber: string

  invoiceDate: string

  dueDate: string

  totalAmount: number

  currency: string

  lineItems: LineItem[]

  status: InvoiceStatus

  matchedPOId?: string

  discrepancies?: Discrepancy[]

  approvedBy?: string

  approvedAt?: string

  rejectedReason?: string

  aiConfidence: number

  rawText?: string

  notes?: string

}


// Purchase order type
export interface PurchaseOrder {

  id: string

  poNumber: string

  vendorName: string

  createdAt: string

  totalAmount: number

  currency: string

  lineItems: LineItem[]

  status:
    | "OPEN"
    | "PARTIALLY_INVOICED"
    | "FULLY_INVOICED"
    | "CLOSED"

}


// CREATE
export async function putInvoice(invoice: Invoice) {

  return await supabase
    .from(TABLES.INVOICES)
    .upsert(invoice)

}


// GET
export async function getInvoice(id: string) {

  const { data } = await supabase
    .from(TABLES.INVOICES)
    .select("*")
    .eq("id", id)
    .single()


  return data as Invoice | null

}


// UPDATE STATUS
export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  extra?: Partial<Invoice>
){

  return await supabase
    .from(TABLES.INVOICES)
    .update({
      status,
      ...extra
    })
    .eq("id", id)

}


// LIST
export async function listInvoices(
  status?: InvoiceStatus
){

  let query = supabase
    .from(TABLES.INVOICES)
    .select("*")
    .order("uploadedAt", {
      ascending:false
    })


  if(status){

    query = query.eq(
      "status",
      status
    )

  }


  const { data } = await query


  return (data || []) as Invoice[]

}



// PURCHASE ORDERS

export async function listPurchaseOrders(){

  const { data } = await supabase
    .from(TABLES.PURCHASE_ORDERS)
    .select("*")


  return (data || []) as PurchaseOrder[]

}



export async function getPurchaseOrder(id:string){

  const { data } = await supabase
    .from(TABLES.PURCHASE_ORDERS)
    .select("*")
    .eq("id", id)
    .single()


  return data as PurchaseOrder | null

}