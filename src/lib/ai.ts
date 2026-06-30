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
    console.error('[ai] vision extraction failed, falling back to filename hint:', err?.message)
    const namePart = fileName.replace(/\.(jpg|jpeg|png|webp|tiff)$/i, '').replace(/[-_]/g, ' ')
    const fallbackText = `Image invoice. Filename: ${namePart}. Vision extraction failed.`
    return extractInvoiceData(fallbackText)
  }
}
