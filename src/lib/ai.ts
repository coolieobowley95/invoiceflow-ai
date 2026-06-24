import OpenAI from 'openai'
import type { Invoice, LineItem, PurchaseOrder, Discrepancy } from './dynamodb'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
  const prompt = `You are an expert accounts payable AI. Extract structured data from this invoice text.

Return ONLY valid JSON with this exact structure:
{
  "vendorName": "string",
  "vendorEmail": "string or null",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "totalAmount": number,
  "currency": "USD",
  "lineItems": [
    {
      "description": "string",
      "quantity": number,
      "unitPrice": number,
      "total": number
    }
  ],
  "confidence": 0.0 to 1.0
}

If a field cannot be determined, use reasonable defaults. Set confidence lower for uncertain extractions.

Invoice text:
---
${rawText}
---`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0].message.content || '{}'
  const parsed = JSON.parse(content)

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
  // Find best matching PO by vendor name similarity + amount proximity
  const candidates = purchaseOrders.filter(po => {
    const vendorSimilar = po.vendorName.toLowerCase().includes(invoice.vendorName.toLowerCase()) ||
      invoice.vendorName.toLowerCase().includes(po.vendorName.toLowerCase())
    const amountClose = Math.abs(po.totalAmount - invoice.totalAmount) / po.totalAmount < 0.15 // within 15%
    return vendorSimilar || amountClose
  })

  if (candidates.length === 0) return { po: null, discrepancies: [] }

  // Pick best match (closest amount)
  const bestPO = candidates.sort((a, b) =>
    Math.abs(a.totalAmount - invoice.totalAmount) - Math.abs(b.totalAmount - invoice.totalAmount)
  )[0]

  const discrepancies: Discrepancy[] = []

  // Check amount discrepancy
  const amountDiff = Math.abs(bestPO.totalAmount - invoice.totalAmount)
  const amountDiffPct = amountDiff / bestPO.totalAmount
  if (amountDiffPct > 0.01) {
    discrepancies.push({
      field: 'Total Amount',
      invoiceValue: invoice.totalAmount,
      poValue: bestPO.totalAmount,
      severity: amountDiffPct > 0.05 ? 'HIGH' : amountDiffPct > 0.02 ? 'MEDIUM' : 'LOW',
    })
  }

  // Check line item count
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
  const prompt = `You are an AP manager AI assistant. Write a concise 2-3 sentence approval summary for this invoice.

Invoice: ${invoice.invoiceNumber} from ${invoice.vendorName}
Amount: $${invoice.totalAmount} ${invoice.currency}
Status: ${invoice.status}
Matched PO: ${invoice.matchedPOId || 'None found'}
Discrepancies: ${invoice.discrepancies?.length || 0} found
AI Confidence: ${Math.round(invoice.aiConfidence * 100)}%

Be factual and direct. Flag any concerns clearly.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150,
    temperature: 0.3,
  })

  return response.choices[0].message.content || 'Summary unavailable.'
}
