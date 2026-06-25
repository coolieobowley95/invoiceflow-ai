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
  lineItems: any[]
  status: InvoiceStatus
  matchedPOId?: string
  discrepancies?: any[]
  approvedBy?: string
  approvedAt?: string
  rejectedReason?: string
  aiConfidence: number
  rawText?: string
  notes?: string
}


export interface PurchaseOrder {
  id: string
  poNumber: string
  vendorName: string
  createdAt: string
  totalAmount: number
  currency: string
  lineItems: any[]
  status: string
}


// CREATE
export async function putInvoice(invoice: Invoice) {

  return await supabase
    .from(TABLES.INVOICES)
    .insert(invoice)

}


// GET
export async function getInvoice(id:string){

  const {data} = await supabase
    .from(TABLES.INVOICES)
    .select("*")
    .eq("id",id)
    .single()

  return data

}


// UPDATE STATUS
export async function updateInvoiceStatus(
id:string,
status:InvoiceStatus,
extra?:Partial<Invoice>
){

return await supabase
.from(TABLES.INVOICES)
.update({
  status,
  ...extra
})
.eq("id",id)

}


// LIST
export async function listInvoices(
status?:InvoiceStatus
){

let query = supabase
.from(TABLES.INVOICES)
.select("*")
.order("uploadedAt",{ascending:false})


if(status){
 query=query.eq("status",status)
}


const {data}=await query


return data || []

}


// PURCHASE ORDERS

export async function listPurchaseOrders(){

const {data}=await supabase
.from(TABLES.PURCHASE_ORDERS)
.select("*")


return data || []

}



export async function getPurchaseOrder(id:string){

const {data}=await supabase
.from(TABLES.PURCHASE_ORDERS)
.select("*")
.eq("id",id)
.single()


return data

}