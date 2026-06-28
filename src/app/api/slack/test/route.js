import slack from "@/lib/slack";

export async function GET() {

  await slack.chat.postMessage({

    channel: "#new-channel",

    // fallback text for notifications/accessibility
    text: "InvoiceFlow AP Agent - New invoice requires approval",

    blocks: [

      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🤖 InvoiceFlow AP Agent"
        }
      },

      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
`*New Invoice Requires Approval*

🏢 *Vendor:* Acme Supplies

💰 *Amount:* $12,450 USD

📄 *Invoice:* INV-20491

⚠️ *Risk Level:* Medium

🤖 *AI Recommendation:*
Approve - Vendor matches previous transactions and no issues were detected.`
        }
      },

      {
        type: "divider"
      },

      {
        type: "actions",
        elements: [

          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ Approve"
            },
            style: "primary",
            action_id: "approve_invoice"
          },

          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ Reject"
            },
            style: "danger",
            action_id: "reject_invoice"
          }

        ]
      }

    ]

  });


  return Response.json({
    success: true,
    message: "InvoiceFlow Slack approval sent"
  });

}