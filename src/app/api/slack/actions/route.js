export const dynamic = "force-dynamic";

import { createHmac, timingSafeEqual } from "crypto";
import { getInvoice, updateInvoiceStatus } from "@/lib/dynamodb";
import { updateApprovalMessage } from "@/lib/slack";

// ---------------------------------------------------------------------------
// Verify Slack's request signature so only real Slack payloads are accepted.
// ---------------------------------------------------------------------------
async function verifySlackSignature(req, rawBody) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn("[slack/actions] SLACK_SIGNING_SECRET not set — skipping verification");
    return true;
  }

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const slackSig = req.headers.get("x-slack-signature");

  if (!timestamp || !slackSig) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
  } catch {
    return false;
  }
}

export async function POST(req) {
  try {
    const rawBody = await req.text();

    const valid = await verifySlackSignature(req, rawBody);
    if (!valid) {
      console.warn("[slack/actions] Invalid Slack signature — rejected");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URLSearchParams(rawBody);
    const payloadString = params.get("payload");

    if (!payloadString) {
      return Response.json({ success: false, message: "No payload" }, { status: 400 });
    }

    const payload = JSON.parse(payloadString);
    const action = payload?.actions?.[0];

    if (!action) {
      return Response.json({ success: false, message: "No action" }, { status: 400 });
    }

    const actionId = action.action_id;
    const invoiceId = action.value;
    const slackUserName = payload?.user?.name ?? payload?.user?.username ?? "slack-user";
    const messageChannel = payload?.channel?.id;
    const messageTs = payload?.message?.ts;

    console.log(`[slack/actions] ${actionId} for invoice ${invoiceId} by ${slackUserName}`);

    if (!invoiceId) {
      console.error("[slack/actions] No invoice ID in action value");
      return Response.json({ success: false, message: "Missing invoice ID" }, { status: 400 });
    }

    const invoice = await getInvoice(invoiceId);
    if (!invoice) {
      console.error(`[slack/actions] Invoice ${invoiceId} not found`);
      return Response.json({ success: false, message: "Invoice not found" }, { status: 404 });
    }

    const newStatus = actionId === "approve_invoice" ? "APPROVED" : "REJECTED";

    const extra =
      newStatus === "APPROVED"
        ? { approvedBy: slackUserName, approvedAt: new Date().toISOString() }
        : { rejectedReason: `Rejected via Slack by ${slackUserName}` };

    await updateInvoiceStatus(invoiceId, newStatus, extra);
    console.log(`[slack/actions] ✅ Invoice ${invoiceId} updated to ${newStatus}`);

    if (messageChannel && messageTs) {
      await updateApprovalMessage({
        channel: messageChannel,
        ts: messageTs,
        decision: newStatus,
        decidedBy: slackUserName,
        invoiceId: invoice.id,
        vendorName: invoice.vendorName,
        totalAmount: invoice.totalAmount,
      });
      console.log(`[slack/actions] ✅ Slack message updated`);
    }

    return Response.json({ success: true, status: newStatus });

  } catch (error) {
    console.error("[slack/actions] Error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}