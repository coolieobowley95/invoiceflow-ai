import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export const dynamo = DynamoDBDocumentClient.from(client)

export const TABLES = {
  INVOICES: process.env.DYNAMODB_TABLE_NAME || 'invoiceflow-invoices',
  PURCHASE_ORDERS: process.env.DYNAMODB_PO_TABLE_NAME || 'invoiceflow-purchase-orders',
}

// Invoice status flow: PENDING → PROCESSING → MATCHED | DISCREPANCY → APPROVED | REJECTED → PAID
export type InvoiceStatus = 'PENDING' | 'PROCESSING' | 'MATCHED' | 'DISCREPANCY' | 'APPROVED' | 'REJECTED' | 'PAID'

export interface Invoice {
  id: string                    // PK
  uploadedAt: string            // ISO timestamp
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
  aiConfidence: number          // 0-1 confidence score from extraction
  rawText?: string
  notes?: string
}

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  total: number
}

export interface Discrepancy {
  field: string
  invoiceValue: string | number
  poValue: string | number
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface PurchaseOrder {
  id: string                    // PK
  poNumber: string
  vendorName: string
  createdAt: string
  totalAmount: number
  currency: string
  lineItems: LineItem[]
  status: 'OPEN' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED' | 'CLOSED'
}

// CRUD helpers
export async function putInvoice(invoice: Invoice) {
  return dynamo.send(new PutCommand({
    TableName: TABLES.INVOICES,
    Item: invoice,
  }))
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const res = await dynamo.send(new GetCommand({
    TableName: TABLES.INVOICES,
    Key: { id },
  }))
  return (res.Item as Invoice) || null
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus, extra?: Partial<Invoice>) {
  const updateExpr = ['#status = :status', 'updatedAt = :updatedAt']
  const exprNames: Record<string, string> = { '#status': 'status' }
  const exprValues: Record<string, unknown> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  }

  if (extra) {
    Object.entries(extra).forEach(([key, val]) => {
      updateExpr.push(`#${key} = :${key}`)
      exprNames[`#${key}`] = key
      exprValues[`:${key}`] = val
    })
  }

  return dynamo.send(new UpdateCommand({
    TableName: TABLES.INVOICES,
    Key: { id },
    UpdateExpression: `SET ${updateExpr.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }))
}

export async function listInvoices(status?: InvoiceStatus): Promise<Invoice[]> {
  // Full scan for demo — in production add a GSI on status
  const res = await dynamo.send(new ScanCommand({
    TableName: TABLES.INVOICES,
    ...(status ? {
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    } : {}),
  }))
  return ((res.Items || []) as Invoice[]).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  )
}

export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  const res = await dynamo.send(new ScanCommand({ TableName: TABLES.PURCHASE_ORDERS }))
  return (res.Items || []) as PurchaseOrder[]
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  const res = await dynamo.send(new GetCommand({
    TableName: TABLES.PURCHASE_ORDERS,
    Key: { id },
  }))
  return (res.Item as PurchaseOrder) || null
}
