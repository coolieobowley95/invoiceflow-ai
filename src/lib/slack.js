import { WebClient } from "@slack/web-api";
import { getUserToken } from "./slackOAuth";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export default slack;

// ---------------------------------------------------------------------------
// Real-Time Search: look up this vendor's history in the Slack workspace.
// This uses the actual RTS API — assistant.search.context — not the
// deprecated search.messages method.
//
// Token shape matters here: assistant.search.context can be called with a
// bot token, but only alongside an `action_token` minted from a live
// message/app_mention event. Since this runs from a background job (right
// after an invoice upload, not in response to a Slack message), that shape
// doesn't apply — so this uses a standing *user* token instead, which needs
// no action_token. That token comes from the one-time OAuth consent flow at
// /api/slack/oauth/install and is stored in Supabase (see slackOAuth.js).
// ---------------------------------------------------------------------------
async function searchVendorHistory(vendorName) {
  if (!vendorName || vendorName === "Unknown Vendor") return null;

  const tokenRow = await getUserToken();
  if (!tokenRow?.access_token) {
    console.warn(
      "[slack] No Real-Time Search token on file yet — visit /api/slack/oauth/install once to connect it."
    );
    return null;
  }

  try {
    const userClient = new WebClient(tokenRow.access_token);

    // assistant.search.context isn't in @slack/web-api's typed helpers yet,
    // so it's called directly via apiCall (the same mechanism every typed
    // method uses under the hood).
    const result = await userClient.apiCall("assistant.search.context", {
      query: `${vendorName} invoice`,
      content_types: ["messages"],
      channel_types: ["public_channel"],
      limit: 3,
      sort: "timestamp",
      sort_dir: "desc",
    });

    // Be defensive about the exact response envelope — this is a newer API
    // and shapes have shifted across rollout stages.
    const rawMatches = result?.results?.messages ?? result?.messages ?? result?.results ?? [];
    const matches = Array.isArray(rawMatches) ? rawMatches : [];
    if (matches.length === 0) return null;

    const previews = matches.slice(0, 2).map((m) => {
      const text = m.text ?? m.message?.text ?? "";
      const ts = m.ts ?? m.message?.ts;
      const dateLabel = ts
        ? new Date(parseFloat(ts) * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "unknown date";
      return `• ${dateLabel} — ${String(text).slice(0, 80)}`;
    });

    return {
      count: matches.length,
      previews,
      channelName: matches[0]?.channel?.name ?? matches[0]?.channel_name ?? "unknown",
    };
  } catch (err) {
    console.warn("[slack] RTS vendor search failed:", err?.data?.error || err?.message);
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
            text: `*🔍 Vendor history (via Slack Real-Time Search API)*\n${vendorHistory.previews.join(
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
