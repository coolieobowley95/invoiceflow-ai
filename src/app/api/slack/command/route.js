export const dynamic = "force-dynamic";

import { createHmac, timingSafeEqual } from "crypto";
import { listInvoices } from "@/lib/dynamodb";
import { sendInvoiceToSlack } from "@/lib/slack";

async function verifySlackSignature(req, rawBody) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true;

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
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URLSearchParams(rawBody);
    const text = (params.get("text") || "").trim().toLowerCase();

    const invoices = await listInvoices();
    const pending = invoices.filter((i) =>
      ["PENDING", "MATCHED", "DISCREPANCY"].includes(i.status)
    );
    const approved = invoices.filter((i) => i.status === "APPROVED").length;
    const rejected = invoices.filter((i) => i.status === "REJECTED").length;
    const totalValue = pending.reduce((s, i) => s + (i.totalAmount || 0), 0);

    // /invoiceflow demo — posts the next pending invoice to Slack for approval
    if (text === "demo") {
      const latest = pending[0];
      if (!latest) {
        return Response.json({
          response_type: "ephemeral",
          text: "No pending invoices found. Upload one at your app first.",
        });
      }

      sendInvoiceToSlack(latest).catch((err) =>
        console.error("[command] demo failed:", err?.message)
      );

      return Response.json({
        response_type: "ephemeral",
        text: `Sending approval request for *${latest.vendorName}* ($${Number(
          latest.totalAmount
        ).toLocaleString()}) to this channel now…`,
      });
    }

    // /invoiceflow or /invoiceflow status — show live dashboard in Slack
    if (text === "status" || text === "") {
      return Response.json({
        response_type: "in_channel",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🤖 InvoiceFlow AI — Dashboard",
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Pending approval*\n${pending.length} invoice${
                  pending.length === 1 ? "" : "s"
                }`,
              },
              {
                type: "mrkdwn",
                text: `*Total value pending*\n$${totalValue.toLocaleString()}`,
              },
              {
                type: "mrkdwn",
                text: `*Approved (all time)*\n${approved}`,
              },
              {
                type: "mrkdwn",
                text: `*Rejected (all time)*\n${rejected}`,
              },
            ],
          },
          ...(pending.length > 0
            ? [
                { type: "divider" },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*Next up:* ${pending[0].vendorName} — $${Number(
                      pending[0].totalAmount
                    ).toLocaleString()} (${pending[0].invoiceNumber})\nType \`/invoiceflow demo\` to send the approval request here.`,
                  },
                },
              ]
            : []),
        ],
      });
    }

    return Response.json({
      response_type: "ephemeral",
      text: "Usage:\n• `/invoiceflow` or `/invoiceflow status` — show live dashboard\n• `/invoiceflow demo` — send next pending invoice for approval",
    });

  } catch (error) {
    console.error("[slack/command] Error:", error);
    return Response.json({
      response_type: "ephemeral",
      text: `Something went wrong: ${error.message}`,
    });
  }
}