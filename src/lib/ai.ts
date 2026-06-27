import Groq from 'groq-sdk'
import type { Invoice, LineItem, PurchaseOrder, Discrepancy } from './dynamodb'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export interface ExtractionResult {
  vendorName: string
  vendorEmail?: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  totalAmount: number
  currency: string
  lineItems: LineItem[]
  confidence: number
}

export async function extractInvoiceData(rawText: string): Promise<ExtractionResult> {
  const prompt = `Extract invoice data and return ONLY valid JSON:
{
  "vendorName": "string",
  "vendorEmail": "string or null",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "totalAmount": number,
  "currency": "USD",
  "lineItems": [{"description": "string", "quantity": number, "unitPrice": number, "total": number}],
  "confidence": 0.0 to 1.0
}

Invoice:
${rawText.slice(0, 3000)}`

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1000,
  })

  let parsed: any = {}
  try {
    const content = response.choices[0].message.content || '{}'
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch {
    parsed = {}
  }

  return {
    vendorName: parsed.vendorName || 'Unknown Vendor',
    vendorEmail: parsed.vendorEmail || undefined,
    invoiceNumber: parsed.invoiceNumber || `INV-${Date.now()}`,
    invoiceDate: parsed.invoiceDate || new Date().toISOString().split('T')[0],
    dueDate: parsed.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : 0,
    currency: parsed.currency || 'USD',
    lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  }
}

export function matchInvoiceToPO(
  invoice: ExtractionResult,
  purchaseOrders: PurchaseOrder[]
): { po: PurchaseOrder | null; discrepancies: Discrepancy[] } {
  const candidates = purchaseOrders.filter(po => {
    const vendorSimilar =
      po.vendorName.toLowerCase().includes(invoice.vendorName.toLowerCase()) ||
      invoice.vendorName.toLowerCase().includes(po.vendorName.toLowerCase())
    const amountClose =
      Math.abs(po.totalAmount - invoice.totalAmount) / (po.totalAmount || 1) < 0.15
    return vendorSimilar || amountClose
  })

  if (candidates.length === 0) return { po: null, discrepancies: [] }

  const bestPO = candidates.sort(
    (a, b) =>
      Math.abs(a.totalAmount - invoice.totalAmount) -
      Math.abs(b.totalAmount - invoice.totalAmount)
  )[0]

  const discrepancies: Discrepancy[] = []

  const amountDiff = Math.abs(bestPO.totalAmount - invoice.totalAmount)
  const amountDiffPct = amountDiff / (bestPO.totalAmount || 1)
  if (amountDiffPct > 0.01) {
    discrepancies.push({
      field: 'Total Amount',
      invoiceValue: invoice.totalAmount,
      poValue: bestPO.totalAmount,
      severity: amountDiffPct > 0.05 ? 'HIGH' : amountDiffPct > 0.02 ? 'MEDIUM' : 'LOW',
    })
  }

  if (bestPO.lineItems.length !== invoice.lineItems.length) {
    discrepancies.push({
      field: 'Line Item Count',
      invoiceValue: invoice.lineItems.length,
      poValue: bestPO.lineItems.length,
      severity: 'MEDIUM',
    })
  }

  return { po: bestPO, discrepancies }
}

export async function generateApprovalSummary(invoice: Invoice): Promise<string> {
  const prompt = `Write a 2-3 sentence AP approval summary for this invoice:
Invoice: ${invoice.invoiceNumber} from ${invoice.vendorName}
Amount: $${invoice.totalAmount} ${invoice.currency}
Status: ${invoice.status}
Matched PO: ${invoice.matchedPOId || 'None'}
Discrepancies: ${invoice.discrepancies?.length || 0}
AI Confidence: ${Math.round(invoice.aiConfidence * 100)}%`

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150,
    temperature: 0.3,
  })

  return response.choices[0].message.content || 'Summary unavailable.'
}