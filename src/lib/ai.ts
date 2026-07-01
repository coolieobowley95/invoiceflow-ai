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
  const today = new Date().toISOString().split('T')[0]
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const prompt = `You are an expert invoice data extraction AI. Your job is to find invoice information from any text, even if it is messy, partial, or poorly formatted.

INSTRUCTIONS:
- Read the text carefully and extract every piece of invoice data you can find
- Look for: company names, vendor names, supplier names, bill from, service provider
- Look for: invoice numbers, reference numbers, invoice ID, bill number
- Look for: dates in any format (Jan 25 2026, 01/25/2026, 2026-01-25, etc)
- Look for: dollar amounts, totals, subtotals, amount due, balance due
- Look for: line items, services, products, descriptions with prices
- Look for: email addresses near company names
- Even if the text is short or unclear, extract whatever you can find
- Set confidence between 0.0 and 1.0 based on how much data you found

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks. Just raw JSON:
{
  "vendorName": "the company or person sending the invoice, or Unknown Vendor if not found",
  "vendorEmail": "email address or null",
  "invoiceNumber": "invoice number or reference number found, or INV-${Date.now()} if not found",
  "invoiceDate": "date in YYYY-MM-DD format or ${today} if not found",
  "dueDate": "due date in YYYY-MM-DD format or ${in30Days} if not found",
  "totalAmount": 0,
  "currency": "USD",
  "lineItems": [
    {
      "description": "item or service description",
      "quantity": 1,
      "unitPrice": 0,
      "total": 0
    }
  ],
  "confidence": 0.5
}

INVOICE TEXT TO EXTRACT FROM:
---
${rawText.slice(0, 4000)}
---

Remember: return ONLY the JSON object, nothing else.`

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: 'You are an invoice extraction AI. You always respond with valid JSON only. Never include markdown, code blocks, or explanations. Only output the raw JSON object.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 1500,
  })

  let parsed: any = {}
  try {
    const content = response.choices[0].message.content || '{}'
    const cleaned = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch (err) {
    console.error('[ai] JSON parse error:', err)
    parsed = {}
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
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.3,
  }
}

// ---------------------------------------------------------------------------
// Vision extraction for image invoices (JPG, PNG, WEBP, TIFF).
// Sends the actual image to llama-3.2-11b-vision-preview so it reads
// the real invoice content instead of guessing from the filename.
// ---------------------------------------------------------------------------
export async function extractInvoiceDataFromImage(
  imageBase64: string,
  mimeType: string,
  fileName: string
): Promise<ExtractionResult> {
  const today = new Date().toISOString().split('T')[0]
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.2-11b-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
            {
              type: 'text',
              text: `You are an expert invoice data extraction AI. Look at this invoice image carefully and extract all data you can see.

Return ONLY a valid JSON object with no explanation, no markdown, no code blocks:
{
  "vendorName": "company or person sending the invoice",
  "vendorEmail": "email address or null",
  "invoiceNumber": "invoice number found, or INV-${Date.now()} if not visible",
  "invoiceDate": "date in YYYY-MM-DD format or ${today} if not visible",
  "dueDate": "due date in YYYY-MM-DD format or ${in30Days} if not visible",
  "totalAmount": 0,
  "currency": "USD",
  "lineItems": [
    { "description": "item description", "quantity": 1, "unitPrice": 0, "total": 0 }
  ],
  "confidence": 0.8
}`,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    })

    const content = response.choices[0].message.content || '{}'
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

    console.log('[ai] vision extraction result:', JSON.stringify(parsed))

    return {
      vendorName: parsed.vendorName || 'Unknown Vendor',
      vendorEmail: parsed.vendorEmail || undefined,
      invoiceNumber: parsed.invoiceNumber || `INV-${Date.now()}`,
      invoiceDate: parsed.invoiceDate || today,
      dueDate: parsed.dueDate || in30Days,
      totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : 0,
      currency: parsed.currency || 'USD',
      lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    }
  } catch (err: any) {
    console.error('[ai] vision extraction failed, falling back to text:', err?.message)
    const namePart = fileName.replace(/\.(jpg|jpeg|png|webp|tiff)$/i, '').replace(/[-_]/g, ' ')
    return extractInvoiceData(`Image invoice. Filename: ${namePart}. Vision extraction failed.`)
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