export const dynamic = "force-dynamic";

import { listInvoices } from "@/lib/dynamodb";
import { sendInvoiceToSlack } from "@/lib/slack";

export async function GET() {
  try {
    const invoices = await listInvoices();
    const latest = invoices.find(
      (i) => i.status !== "PROCESSING" && i.vendorName !== "Processing…"
    );

    const invoice = latest ?? {
      id: `demo-${Date.now()}`,
      uploadedAt: new Date().toISOString(),
      fileName: "sample-invoice.pdf",
      vendorName: "Acme Supplies Ltd",
      invoiceNumber: "INV-2026-0042",
      invoiceDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      totalAmount: 12450,
      currency: "USD",
      lineItems: [],
      status: "MATCHED",
      aiConfidence: 0.87,
      matchedPOId: "PO-2026-0019",
      discrepancies: [],
    };

    const result = await sendInvoiceToSlack(invoice);

    return Response.json({
      success: true,
      message: "Slack approval message sent",
      usingRealInvoice: !!latest,
      invoiceId: invoice.id,
      slackMessageTs: result.ts,
    });
  } catch (error) {
    console.error("[slack/test] Error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
