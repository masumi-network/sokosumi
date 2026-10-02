# ADR 0050: Password sign-up proves the address

- Status: Accepted
- Date: 2026-10-02
- Amends: [ADR 0049](0049-email-codes-replace-magic-links.md)

Core keeps `requireEmailVerification: false`, so a password sign-up through `/sign-up/email` created an account whose address nobody had proven. Since [ADR 0049](0049-email-codes-replace-magic-links.md), sign-in on a new browser opens on the email code. A code sign-in to such an account runs Better Auth's `revokeUnprovenAccountAccess`: it deletes the password and every Google or Microsoft link, ends all sessions and marks the address proven. That protection against pre-hijacked accounts stays. Sokosumi no longer walks people into it unawares.

- **Password sign-up goes through the email code.** The sign-up page sends the password with the code to `/sign-in/email-otp`. Better Auth creates the account with its address proven, and Core's `emailCodeSignIn` plugin (`apps/core/src/lib/auth-email-code-sign-in.ts`) wraps Better Auth's OTP endpoint. It hashes the password before writes, then commits OTP consumption, user creation, session creation and credential linking in one transaction before publishing the session cookies. Failed credential writes roll back the signup, leaving the code available for retry. Wrong-code attempts still commit their attempt counter. A concurrent signup collision is refused rather than silently dropping the selected password. `/sign-up/email` is in `disabledPaths`. The plugin checks the password's length and refuses an address that has an account before the code is spent, so that code still signs in. `lastLoginMethod` remembers such a sign-up as `email`, like a password sign-in.
- **Sign-in opens on the password for an account that has one.** `/sign-up/email-status` also answers `hasPassword`. Step 2 opens on the password, and sends no code, when the account has a password, even when this browser last signed in with a code: the `last_used_login_method` cookie belongs to the browser, and on a shared one it can name another account. A code is one switch away.
- **A code that removes access says so.** Core's plugin sees an unproven account with sign-in methods before the code sign-in and adds `signInMethodsRemoved` (`EMAIL_CODE_SIGN_IN_METHODS_REMOVED` in `@sokosumi/utils`) to a successful response. The page shows a dialog before it leaves, with the way to set a new password in the account. No migration: the fact travels in the response only.

## Considered Options

- **Verify the code, then call `/sign-up/email`.** Better Auth's check endpoint does not spend the code, and nothing would stop a client calling `/sign-up/email` without one. Core would have to reimplement the plugin's encrypted code check.
- **Sign up with the code, then set the password in a second request.** Better Auth's `setPassword` is server-only, so it needs a new Core endpoint, and a person who leaves between the two requests has an account without the password they chose.
- **Disable `revokeUnprovenAccountAccess`.** It is what stops a pre-hijacked account from keeping the hijacker's password.
- **Answer only "unproven with a password" from the status endpoint.** It tells less about proven accounts, but discloses which addresses are unproven, and leaves proven password accounts opening on the code for no reason.

## Consequences

- `hasPassword` is one fact more than `exists` for anyone who knows an address. It narrows a password-guessing list; guessing still meets the captcha and the rate limits on both endpoints.
- Accounts created before this change stay unproven until their owner signs in with a code or follows a verification link. The pull request carries a read-only count.
- The notice reads the account before the code is checked. A verification or a new account landing in between can make it say too much or nothing. The window is the length of one request; the dialog is a courtesy, the removal itself is Better Auth's.
- A Sign in with Sokosumi request (CMO) shows no dialog: Core's OAuth provider replaces the response with its redirect, and the auth client follows it at once. Opening on the password covers the common case there.
- Core and Web ship together. A Web from before this change cannot sign up with a password against a Core that closed `/sign-up/email`. A Web from after it, against an older Core, reads no `hasPassword` and opens on the code, as before.
