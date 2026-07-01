export const dynamic = "force-dynamic";

import { saveUserToken } from "@/lib/slackOAuth";

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return new Response(`Slack authorization was not completed: ${oauthError}`, { status: 400 });
  }
  if (!code) {
    return new Response("Missing OAuth code from Slack redirect.", { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const redirectUri = `${origin}/api/slack/oauth/callback`;

  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID || "",
    client_secret: process.env.SLACK_CLIENT_SECRET || "",
    code,
    redirect_uri: redirectUri,
  });

  let data;
  try {
    const resp = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    data = await resp.json();
  } catch (err) {
    console.error("[slack/oauth/callback] Network error calling oauth.v2.access:", err?.message);
    return new Response("Could not reach Slack to complete authorization.", { status: 502 });
  }

  if (!data.ok) {
    console.error("[slack/oauth/callback] oauth.v2.access failed:", data.error);
    return new Response(`Slack OAuth exchange failed: ${data.error}`, { status: 400 });
  }

  const userToken = data.authed_user?.access_token;
  const grantedScope = data.authed_user?.scope;

  if (!userToken) {
    return new Response(
      "Slack didn't return a user token. Make sure you approved the " +
        "search:read.public permission on the consent screen, not just installed the bot.",
      { status: 400 }
    );
  }

  try {
    await saveUserToken({
      teamId: data.team?.id,
      teamName: data.team?.name,
      accessToken: userToken,
      scope: grantedScope,
      authorizedBy: data.authed_user?.id,
    });
  } catch (err) {
    console.error("[slack/oauth/callback] Failed to persist token:", err?.message);
    return new Response("Authorized with Slack, but failed to save the token. Check Supabase logs.", {
      status: 500,
    });
  }

  return new Response(
    `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; padding: 48px; text-align: center; color: #1a1a1a;">
    <h2>✅ Real-Time Search connected</h2>
    <p>InvoiceFlow AI can now look up vendor history in <b>${data.team?.name || "your workspace"}</b>
    the next time it posts an approval request.</p>
    <p style="color:#666">Scope granted: <code>${grantedScope || "unknown"}</code></p>
    <p>You can close this tab.</p>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}