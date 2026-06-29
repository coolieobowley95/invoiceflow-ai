import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Invoice, LineItem, PurchaseOrder, Discrepancy } from './dynamodb'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

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

export async function extractInvoiceData(
  fileBuffer: Buffer,
  mediaType: string
): Promise<ExtractionResult> {
  const today = new Date().toISOString().split('T')[0]
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const prompt = `You are an invoice data extraction AI. Look carefully at this invoice document and extract all fields.

Return ONLY a valid JSON object, no markdown, no explanation, just raw JSON:
{
  "vendorName": "company or person sending the invoice",
  "vendorEmail": "email address or null",
  "invoiceNumber": "invoice number or reference number",
  "invoiceDate": "date in YYYY-MM-DD format or ${today}",
  "dueDate": "due date in YYYY-MM-DD format or ${in30Days}",
  "totalAmount": 12500,
  "currency": "USD",
  "lineItems": [
    { "description": "item description", "quantity": 1, "unitPrice": 7500, "total": 7500 }
  ],
  "confidence": 0.95
}`

  const result = await model.generateContent([
    {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType: mediaType,
      },
    },
    prompt,
  ])

  const text = result.response.text()

  let parsed: any = {}
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch (err) {
    console.error('[ai] JSON parse error:', err)
  }

  return {
    vendorName: parsed.vendorName || 'Unknown Vendor',
    vendorEmail: parsed.vendorEmail || undefined,
    invoiceNumber: parsed.invoiceNumber || `INV-${Date.now()}`,
    invoiceDate: parsed.invoiceDate || today,
    dueDate: parsed.dueDate || in30Days,
    totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : 0,
    currency: parsed.currency || 'USD',
    lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
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

  const amountDiffPct =
    Math.abs(bestPO.totalAmount - invoice.totalAmount) / (bestPO.totalAmount || 1)
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

  const result = await model.generateContent(prompt)
  return result.response.text() || 'Summary unavailable.'
}
