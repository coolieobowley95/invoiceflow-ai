import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export default slack;

// ---------------------------------------------------------------------------
// Real-Time Search: look up this vendor's history in the Slack workspace.
// This is one of the three required hackathon technologies (RTS API).
// ---------------------------------------------------------------------------
async function searchVendorHistory(vendorName) {
  if (!vendorName || vendorName === "Unknown Vendor") return null;
  try {
    const result = await slack.search.messages({
      query: `${vendorName} invoice`,
      count: 3,
      sort: "timestamp",
      sort_dir: "desc",
    });

    const matches = result?.messages?.matches ?? [];
    if (matches.length === 0) return null;

    const previews = matches.slice(0, 2).map((m) => {
      const ts = m.ts
        ? new Date(parseFloat(m.ts) * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "unknown date";
      return `• ${ts} — ${m.text?.slice(0, 80) ?? ""}`;
    });

    return {
      count: matches.length,
      previews,
      channelName: matches[0]?.channel?.name ?? "unknown",
    };
  } catch (err) {
    console.warn("[slack] RTS vendor search failed:", err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post the Block Kit approval message for a processed invoice.
// ---------------------------------------------------------------------------
export async function sendInvoiceToSlack(invoice) {
  const channel = process.env.SLACK_CHANNEL_ID || "#invoices";

  const riskLabel =
    invoice.aiConfidence >= 0.8
      ? "🟢 Low"
      : invoice.aiConfidence >= 0.5
      ? "🟡 Medium"
      : "🔴 High";

  const discrepancyText =
    invoice.discrepancies?.length > 0
      ? `⚠️ *${invoice.discrepancies.length} discrepanc${
          invoice.discrepancies.length === 1 ? "y" : "ies"
        } found:*\n${invoice.discrepancies
          .map(
            (d) =>
              `  • ${d.field}: invoice *${d.invoiceValue}* vs PO *${d.poValue}* (${d.severity})`
          )
          .join("\n")}`
      : "✅ No discrepancies — matches PO";

  // Real-Time Search — fetch prior vendor messages from workspace
  const vendorHistory = await searchVendorHistory(invoice.vendorName);

  const vendorHistoryBlocks = vendorHistory
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*🔍 Vendor history (via Slack Search)*\n${vendorHistory.previews.join(
              "\n"
            )}\n_${vendorHistory.count} message(s) found in #${
              vendorHistory.channelName
            }_`,
          },
        },
        { type: "divider" },
      ]
    : [];

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🤖 InvoiceFlow AI — Approval Required",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Vendor*\n${invoice.vendorName}` },
        {
          type: "mrkdwn",
          text: `*Amount*\n$${Number(invoice.totalAmount).toLocaleString()} ${
            invoice.currency ?? "USD"
          }`,
        },
        { type: "mrkdwn", text: `*Invoice #*\n${invoice.invoiceNumber}` },
        {
          type: "mrkdwn",
          text: `*AI Confidence*\n${Math.round(
            (invoice.aiConfidence ?? 0) * 100
          )}%`,
        },
        { type: "mrkdwn", text: `*Risk Level*\n${riskLabel}` },
        {
          type: "mrkdwn",
          text: `*PO Match*\n${
            invoice.matchedPOId ? `✅ ${invoice.matchedPOId}` : "❌ No match"
          }`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: discrepancyText },
    },
    { type: "divider" },
    ...vendorHistoryBlocks,
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve" },
          style: "primary",
          action_id: "approve_invoice",
          value: invoice.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject" },
          style: "danger",
          action_id: "reject_invoice",
          value: invoice.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Invoice ID: \`${invoice.id}\` · Uploaded ${new Date(
            invoice.uploadedAt
          ).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`,
        },
      ],
    },
  ];

  const response = await slack.chat.postMessage({
    channel,
    text: `New invoice from ${invoice.vendorName} — $${Number(
      invoice.totalAmount
    ).toLocaleString()} requires approval`,
    blocks,
  });

  return { channel: response.channel, ts: response.ts };
}

// ---------------------------------------------------------------------------
// Update the original message after Approve / Reject is clicked.
// Replaces the buttons with a decision summary.
// ---------------------------------------------------------------------------
export async function updateApprovalMessage({
  channel,
  ts,
  decision,
  decidedBy,
  invoiceId,
  vendorName,
  totalAmount,
}) {
  const isApproved = decision === "APPROVED";

  await slack.chat.update({
    channel,
    ts,
    text: `Invoice ${isApproved ? "approved" : "rejected"} by ${decidedBy}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: isApproved ? "✅ Invoice Approved" : "❌ Invoice Rejected",
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Vendor*\n${vendorName}` },
          {
            type: "mrkdwn",
            text: `*Amount*\n$${Number(totalAmount).toLocaleString()}`,
          },
          {
            type: "mrkdwn",
            text: `*Decision*\n${isApproved ? "✅ Approved" : "❌ Rejected"}`,
          },
          { type: "mrkdwn", text: `*By*\n${decidedBy}` },
          {
            type: "mrkdwn",
            text: `*At*\n${new Date().toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Invoice ID: \`${invoiceId}\`` },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Send a failure notification when invoice processing crashes.
// Ensures the team always knows when something needs manual attention.
// ---------------------------------------------------------------------------
export async function sendFailureNotification(invoiceId, errorMessage) {
  const channel = process.env.SLACK_CHANNEL_ID || "#invoices";
  try {
    await slack.chat.postMessage({
      channel,
      text: `⚠️ Invoice processing failed`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "⚠️ Invoice Processing Failed",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `An invoice could not be processed and needs manual attention.\n\n*Invoice ID:* \`${invoiceId}\`\n*Error:* ${errorMessage}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Failed at ${new Date().toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("[slack] sendFailureNotification failed:", err?.message);
  }
}
