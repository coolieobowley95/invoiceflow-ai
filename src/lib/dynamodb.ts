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


// ---------------------------------------------------------------------------
// Supabase column name mapper
// The DB table uses snake_case columns but the TypeScript types use
// camelCase. This helper converts keys before inserting/updating.
// ---------------------------------------------------------------------------
const CAMEL_TO_SNAKE_OVERRIDES: Record<string, string> = {
  uploadedAt: 'uploaded_at',
  fileName: 'file_name',
  vendorName: 'vendor_name',
  vendorEmail: 'vendor_email',
  invoiceNumber: 'invoice_number',
  invoiceDate: 'invoice_date',
  dueDate: 'due_date',
  totalAmount: 'total_amount',
  lineItems: 'line_items',
  matchedPOId: 'matched_po_id',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  rejectedReason: 'rejected_reason',
  aiConfidence: 'ai_confidence',
  rawText: 'raw_text',
  poNumber: 'po_number',
  unitPrice: 'unit_price',
}

function toSnakeCase(key: string): string {
  return CAMEL_TO_SNAKE_OVERRIDES[key] ?? key.replace(/([A-Z])/g, '_$1').toLowerCase()
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function keysToSnake(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value
  }
  return result
}

function keysToCamel(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value
  }
  return result
}


// CREATE / UPSERT
export async function putInvoice(invoice: Invoice) {
  // Convert camelCase keys to snake_case for Supabase
  const dbRecord = keysToSnake(invoice as any)
  return await supabase
    .from(TABLES.INVOICES)
    .upsert(dbRecord)
}


// GET
export async function getInvoice(id: string) {
  const { data } = await supabase
    .from(TABLES.INVOICES)
    .select("*")
    .eq("id", id)
    .single()

  // Convert snake_case keys back to camelCase
  return (data ? keysToCamel(data) : null) as Invoice | null
}


// UPDATE STATUS
export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  extra?: Partial<Invoice>
){
  const dbExtra = extra ? keysToSnake(extra as any) : {}
  return await supabase
    .from(TABLES.INVOICES)
    .update({
      status,
      ...dbExtra
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
    .order("uploaded_at", {
      ascending:false
    })

  if(status){
    query = query.eq(
      "status",
      status
    )
  }

  const { data } = await query

  // Convert snake_case keys back to camelCase
  return ((data || []) as Record<string, any>[]).map(keysToCamel) as Invoice[]
}



// PURCHASE ORDERS

export async function listPurchaseOrders(){

  const { data } = await supabase
    .from(TABLES.PURCHASE_ORDERS)
    .select("*")


  return ((data || []) as Record<string, any>[]).map(keysToCamel) as PurchaseOrder[]

}



export async function getPurchaseOrder(id:string){

  const { data } = await supabase
    .from(TABLES.PURCHASE_ORDERS)
    .select("*")
    .eq("id", id)
    .single()


  return (data ? keysToCamel(data) : null) as PurchaseOrder | null

}
