# Project social accounts: OAuth and developer setup

This guide is for the team operating Sokosumi. Set up each provider once per
environment; customers then authorize their own social accounts from
**Project → Social**. Customers do not need to create developer apps.

All six providers support account connection, reconnection, replacement, and
disconnection. Publishing and scheduling currently support **X only**. Adding
OAuth permissions does not enable publishing for the other providers.

## Which developer accounts do we need?

Composio brokers OAuth and stores provider tokens. A managed OAuth app uses
Composio's developer credentials. A custom OAuth app uses developer credentials
owned by our team, entered into Composio. We do not implement another OAuth
callback or token store for custom apps.

| Provider | Custom OAuth required? | Where to register if using custom OAuth | Account being connected |
| --- | --- | --- | --- |
| [X](https://docs.composio.dev/toolkits/twitter) | **Yes** | [X Developer Console](https://developer.x.com/) | X user |
| [TikTok](https://docs.composio.dev/toolkits/tiktok) | **Yes** | [TikTok for Developers](https://developers.tiktok.com/) | TikTok user |
| [Instagram](https://docs.composio.dev/toolkits/instagram) | Optional; managed OAuth available | [Meta App Dashboard](https://developers.facebook.com/apps/) | Instagram Business or Creator account |
| [LinkedIn](https://docs.composio.dev/toolkits/linkedin) | Optional; managed OAuth available | [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) | LinkedIn member |
| [Facebook](https://docs.composio.dev/toolkits/facebook) | Optional; managed OAuth available | [Meta App Dashboard](https://developers.facebook.com/apps/) | Authorizing Facebook user; no Page selection yet |
| [YouTube](https://docs.composio.dev/toolkits/youtube) | Optional; managed OAuth available | [Google Cloud Console](https://console.cloud.google.com/) | One YouTube channel |

Managed availability was checked on **2026-09-28**. Recheck the linked toolkit
pages when provisioning. For the four optional providers, start with managed
OAuth if its permissions fit. Choose custom OAuth for our own consent-screen
name, control over permissions, or separate API quota. See
[Composio's managed/custom comparison](https://docs.composio.dev/docs/authentication/custom-app-vs-managed-app).

## Configure Composio and Core

1. Open the [Composio dashboard](https://dashboard.composio.dev/) in the correct
   environment. Keep production and staging API keys, auth configurations, and
   developer credentials separate.
2. Create an auth configuration for each desired toolkit using **OAuth2**.
   Select managed credentials where available, or supply the custom app
   credentials from the provider sections below. Check the requested scopes
   before saving; managed configurations may request more than our identity
   lookup needs.
3. For custom apps, copy the redirect URI displayed by Composio into the
   provider's OAuth settings. Its exact value must match the configuration's
   `oauth_redirect_uri`. Composio documents
   `https://backend.composio.dev/api/v3/toolkits/auth/callback`, but some
   configurations still use `https://backend.composio.dev/api/v1/auth-apps/add`.
   Copy the value for this configuration instead of guessing or mixing them.
   See [Composio's redirect setup](https://docs.composio.dev/docs/auth-configuration/custom-auth-configs).
4. Save each auth configuration and copy its **auth config ID** (`ac_…`). This
   is different from the provider's client ID and a connected-account ID.
5. Set `COMPOSIO_API_KEY` and the following variables on **Core**, using IDs
   from the same Composio environment as the API key. Restart/redeploy Core
   after changing its environment.

| Toolkit | Core environment variable | Access used for account identity |
| --- | --- | --- |
| `twitter` | `COMPOSIO_X_AUTH_CONFIG_ID` | `tweet.read`, `users.read`; retain existing publishing scopes |
| `tiktok` | `COMPOSIO_TIKTOK_AUTH_CONFIG_ID` | `user.info.basic` |
| `instagram` | `COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID` | `instagram_business_basic` with Instagram Login |
| `linkedin` | `COMPOSIO_LINKEDIN_AUTH_CONFIG_ID` | `openid`, `profile` |
| `facebook` | `COMPOSIO_FACEBOOK_AUTH_CONFIG_ID` | `public_profile` |
| `youtube` | `COMPOSIO_YOUTUBE_AUTH_CONFIG_ID` | `https://www.googleapis.com/auth/youtube.readonly` |

An explicit auth config ID is required even for managed OAuth. Sokosumi does
not create configurations automatically. Leave unconfigured variables unset;
their connection buttons report a setup error before starting authorization.
The template is [Core's `.env.example`](../apps/core/.env.example).

Provider client secrets belong in Composio's custom auth configuration. Core
needs only the Composio API key and auth config IDs; none belong in public Web
environment variables or source control. Composio retains the provider tokens.

### The two callback URLs

| URL | Purpose | Where to configure |
| --- | --- | --- |
| Composio's `oauth_redirect_uri` | Provider returns its authorization code to Composio | Provider developer app and matching Composio auth config |
| `<web-origin>/composio/callback` | Composio returns the browser to Sokosumi to finish the Project connection | Sokosumi connection flow; verify it points to the intended Web deployment |

Do not put the Sokosumi return URL in the provider's OAuth redirect field.
Core validates the provider, auth configuration, initiating user, and connected
account before saving the connection. Its shared account is restricted to the
Project's Core executor, as described in
[ADR-0042](adr/0042-core-owned-project-social-connections.md).

## Provider setup

### X: custom app required

1. Create or use the team's X developer account and app. Ensure its API access
   covers user lookup and the existing publishing operations.
2. Enable OAuth 2.0 user authentication. Choose a confidential client such as
   **Web App**, then register Composio's redirect URI and the requested website
   details.
3. Copy the **OAuth 2.0 Client ID and Client Secret** into a custom `twitter`
   auth configuration. An app-only bearer token or OAuth 1.0 API key is not a
   replacement for these credentials.
4. Preserve `tweet.read`, `users.read`, `tweet.write`, and `offline.access` for
   the existing text publishing and refresh flow. Retain `media.write` if the
   deployment uses media uploads. Do not reduce an existing publishing config
   to identity-only scopes. Reauthorize accounts after changing permissions.

X documents client types and refresh tokens in its
[OAuth 2.0 guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
and required endpoint scopes in its
[authentication mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping).
Each environment uses an owned app under ADR-0042. Check current access and
quota in the developer console before rollout.

### TikTok: custom app required

1. Register the team's developer account, then create an app under **Manage
   apps**. Select the Web platform and supply the website, privacy policy,
   terms, and other requested app details.
2. Add **Login Kit**, register Composio's HTTPS redirect URI, and enable
   `user.info.basic`. Copy the app's **client key** and **client secret** into
   the custom `tiktok` configuration fields requested by Composio.
3. Use a Sandbox app and authorized test users for initial testing. Before
   public rollout, complete URL ownership verification and submit the app for
   review. Registering credentials alone does not grant production approval.

See TikTok's [app registration](https://developers.tiktok.com/docs/en/getting-started-create-an-app),
[Sandbox setup](https://developers.tiktok.com/docs/en/add-a-sandbox),
and [Web Login Kit](https://developers.tiktok.com/docs/en/login-kit-web) guides.
Sokosumi reads `open_id` and `display_name`; this flow does not need Content
Posting API access or video-upload permissions.

### Instagram: managed app or optional custom Meta app

Use a Business or Creator account; Personal accounts are unsupported. With
managed OAuth, create the `instagram` auth configuration and proceed to testing.

For custom OAuth, register a Meta developer account and create an app with
**Instagram API with Instagram Login**. Configure its business login redirect
with Composio's URI. Supply the Instagram OAuth client credentials requested
by Composio and request `instagram_business_basic`. Use the Instagram product's
credentials, rather than assuming every ID shown in the Meta dashboard is
interchangeable.

Add and authorize the appropriate test account/app role for development. Before
connecting accounts outside those roles, complete the access review and any
business verification required by the app dashboard. Use Meta's
[Instagram Login setup](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/)
for the current requirements. Meta's documentation may require a developer login.

This scope belongs to Instagram Login. A Facebook Login configuration uses
different permissions and account discovery; do not substitute that flow for
this configuration. The [Composio toolkit](https://docs.composio.dev/toolkits/instagram)
also documents account restrictions and permission-dependent features.

### LinkedIn: managed app or optional custom developer app

For managed OAuth, create the `linkedin` auth configuration. For custom OAuth:

1. Create an app in the LinkedIn Developer Portal, providing the organization's
   LinkedIn Page and app details requested by registration.
2. Under **Products**, request **Sign In with LinkedIn using OpenID Connect**.
   Ensure `openid` and `profile` are available. Email and posting permissions
   are not needed for Sokosumi's account identity lookup.
3. In **Auth**, add Composio's authorized redirect URL. Copy the client ID and
   client secret into the custom `linkedin` configuration.

See [app registration](https://learn.microsoft.com/en-us/power-pages/security/authentication/oauth2-linkedin#create-an-app-registration-in-linkedin),
[OIDC product access](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2),
and [OAuth configuration](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).
The saved identity is a member, not a company Page. Requesting marketing or
organization publishing products is outside this account-connection setup.

### Facebook: managed app or optional custom Meta app

For managed OAuth, create the `facebook` auth configuration. For custom OAuth,
register a Meta developer account, create an app with a Facebook Login use
case, and configure Composio's URI as an allowed OAuth redirect. Enter the
app ID and app secret into Composio; the identity lookup needs `public_profile`
for the authorizing user's ID and name.

Test with users assigned appropriate app roles while the app is in development.
Before external customer use, complete the dashboard's launch requirements,
including any required permission access review or business verification.
Consult [Meta's app setup](https://developers.facebook.com/docs/development/create-an-app/)
and [Facebook Login](https://developers.facebook.com/docs/facebook-login/web/)
while signed into the developer account; exact requirements depend on the
selected use case and permissions.

Composio's [Facebook toolkit](https://docs.composio.dev/toolkits/facebook)
publishing features target Pages. This implementation only records the
authorizing user's identity. It does not choose a Page, save a Page publishing
target, or publish to personal feeds. Page publishing permissions are not
required by this identity-only lookup.

### YouTube: managed app or optional custom Google Cloud app

For managed OAuth, create the `youtube` auth configuration. For custom OAuth:

1. Create/select a Google Cloud project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen in Google Auth Platform: app branding,
   audience, contact information, and the `youtube.readonly` scope from the
   table above. Use an External audience if customers outside the organization
   need access; add test users during development.
3. Create an OAuth client of type **Web application**. Register Composio's
   exact authorized redirect URI, then enter the client ID and client secret
   into the custom `youtube` configuration. Use user OAuth for this connection,
   not an API key or service account.
4. Move the app to production and complete applicable Google verification
   before customer rollout. External apps in Testing normally issue refresh
   tokens that expire after seven days for this scope.

See Google's [YouTube OAuth setup](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps),
[production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
and [refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).
The authorizing account must have a YouTube channel. Sokosumi requires exactly
one channel from the authenticated lookup and rejects missing or ambiguous
results; a Google account alone is insufficient.

## Verify before enabling customer connections

- Confirm the API key, toolkit, auth config ID, scopes, and developer app all
  belong to the intended environment.
- Connect a real test account from Project → Social. Complete consent and
  confirm the correct provider and account/channel name after reloading.
- Exercise reconnect, replacement with another account, cancellation, and
  disconnect. Check that another Project does not gain access to the account.
- For public rollout, repeat with an account outside the app's developer/tester
  roles after provider approval. A successful developer-only test does not
  establish customer access.
- Recheck consent after permission changes; existing grants do not acquire
  newly added permissions automatically. Test again when replacing an auth
  configuration or developer app, since provider identity IDs can be app-scoped.

Common failures:

| Symptom | Check |
| --- | --- |
| Setup error before consent | Missing Core API key/auth config variable; wrong Composio environment |
| Redirect mismatch | Exact URI in both the provider app and Composio, including path and trailing slash |
| Works for team accounts only | Sandbox/test-user restrictions, app roles, publishing status, product access/review |
| Consent succeeds but identity fails | Granted scopes, supported account type, channel existence, toolkit/config mismatch |
| YouTube needs frequent reconnection | Google External/Testing refresh-token expiration |
| X lookup/publishing is denied | Developer app API access, granted scopes, and quota |

Automated tests cover provider response fixtures and lifecycle validation.
Live OAuth still requires configured apps and real accounts; this guide is a
setup procedure, not evidence that provider review or live testing has completed.
