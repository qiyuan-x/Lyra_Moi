import { ANTIGRAVITY_OAUTH_SETTINGS } from "@lyra/contracts";

// Public desktop OAuth client parameter used by Cockpit Tools oauth.rs and
// sub2api internal/pkg/antigravity/oauth.go. This is not a user's credential.
const DESKTOP_CLIENT_SECRET = "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";

export function defaultAntigravityClientSecret(settings: Record<string, unknown>): string | null {
  if (settings.antigravity !== true
    || settings.oauthClientId !== ANTIGRAVITY_OAUTH_SETTINGS.oauthClientId
    || settings.oauthTokenUrl !== ANTIGRAVITY_OAUTH_SETTINGS.oauthTokenUrl
    || settings.oauthAuthorizeUrl !== ANTIGRAVITY_OAUTH_SETTINGS.oauthAuthorizeUrl) return null;
  return DESKTOP_CLIENT_SECRET;
}
