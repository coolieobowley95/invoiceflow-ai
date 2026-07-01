import { supabase } from "@/lib/supabase";

const TABLE = "slack_user_tokens";

// ---------------------------------------------------------------------------
// InvoiceFlow AI is a single-workspace app, so in practice there is only ever
// one row here. It's still keyed by team_id (not hardcoded to "the" row) so
// this doesn't silently break if the app is ever installed elsewhere.
// ---------------------------------------------------------------------------

/**
 * Returns the most recently authorized Slack *user* token, or null if no one
 * has completed the /api/slack/oauth/install flow yet.
 */
export async function getUserToken() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[slackOAuth] Could not read stored user token:", error.message);
    return null;
  }

  return data ?? null;
}

/**
 * Persists the user token returned by Slack's oauth.v2.access after someone
 * completes the RTS consent screen.
 */
export async function saveUserToken({ teamId, teamName, accessToken, scope, authorizedBy }) {
  const { error } = await supabase.from(TABLE).upsert({
    team_id: teamId ?? "unknown",
    team_name: teamName ?? null,
    access_token: accessToken,
    scope: scope ?? null,
    authorized_by: authorizedBy ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to store Slack user token: ${error.message}`);
  }
}