# ADR 0049: Email codes replace Magic Links

- Status: Accepted
- Date: 2026-10-01
- Amends: [ADR 0025](0025-better-auth-1-7-account-identity.md)
- Relates to: [ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md)

Sokosumi's passwordless email sign-in sends a six-digit code that is typed back into the tab that asked for it, through Better Auth's `emailOTP` plugin. It replaces the Magic Link everywhere: the sign-in page, the sign-up page and the re-authentication dialog. A link signs in whichever browser opens it. That broke every sign-in for another app ([ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md)), because the app's OAuth `state` lives in the browser that started, and a phone often opens mail links in the mail app's own browser. Mail scanners that open links also spent the single-use token before the person could. A code keeps the person in the tab they started in, so the OAuth request, the gated action or the sign-up form carries on.

## Considered Options

- **Keep the link and hide it during OAuth sign-ins.** Cheap, but CMO, the Apple app and the CLI lose passwordless email, and the scanner and in-app-browser problems remain on Sokosumi itself.
- **Have the app restart sign-in when its `state` does not match.** The person would end up signed in, but in the mail app's browser rather than the tab they started in.
- **Send the link and the code in one email.** One click on desktop, but it needs a custom send issuing two tokens, and the link keeps the scanner problem.

## Consequences

- Codes have six digits, last 10 minutes and allow five wrong tries. A resend repeats the code and extends its expiry (`resendStrategy: "reuse"`), so a late first email still works; that needs the code recoverable, so it is stored encrypted with the auth secret rather than hashed. Web waits 30 seconds between resends. Core's captcha guards the request for a code, not the code itself. The plugin's own rate limit also applies, per IP and path: ten requests a minute, raised from its default of three, which turned away an office or event behind one address. The page asks anyone over it to wait a minute.
- Core closes the plugin's other endpoints (`disabledPaths`) and refuses codes for any purpose but sign-in. Password reset, email verification and email change keep their links.
- A new address creates an account, as the Magic Link did. The sign-up page sends the first and last name with the code, so that account is named; Core validates them like email sign-up. The sign-in page asks for the email first and checks it with sign-up's `/sign-up/email-status`, which tells nothing sign-up does not. It sends an address without an account to sign-up instead of emailing a code, so it no longer creates nameless accounts. Its second step opens on the method Better Auth's `last_used_login_method` cookie names, which sign-up sets too: `email` opens on the password, and only then does Continue send no code.
- Signing in with a code to an account whose address is unproven deletes its other sign-in methods (`revokeUnprovenAccountAccess`, see [ADR 0025](0025-better-auth-1-7-account-identity.md)), as the Magic Link did. The re-authentication dialog therefore offers the code only to verified addresses. [ADR 0050](0050-password-sign-up-proves-the-address.md) stops sign-up creating such accounts, opens sign-in on the password for an account that has one, and tells the person when a code removed access.
- Links in mailboxes at deploy time stop working. They lasted 10 minutes.
