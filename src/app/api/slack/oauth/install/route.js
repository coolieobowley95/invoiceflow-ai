export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// One-time setup route. Visiting this URL in a browser (while logged into the
// target Slack workspace) sends the workspace owner through Slack's OAuth
// consent screen for the *Real-Time Search* user scope. We deliberately don't
// request any bot scopes here — the bot token (SLACK_BOT_TOKEN) is already
// installed separately and keeps handling chat:write for approval messages.
// ---------------------------------------------------------------------------

export async function GET(req) {
  const clientId = process.env.SLACK_CLIENT_ID;

  if (!clientId) {
    return new Response(
      "SLACK_CLIENT_ID is not set. Add your Slack app's Client ID (Basic Information page) as an env var first.",
      { status: 500 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const redirectUri = `${origin}/api/slack/oauth/callback`;

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("user_scope", "search:read.public");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  return Response.redirect(authorizeUrl.toString(), 302);
}