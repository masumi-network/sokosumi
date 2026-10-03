# Sign up

Sign up creates an account from the emailed code, with an optional password ([ADR 0050](../../../../docs/adr/0050-password-sign-up-proves-the-address.md)). It needs the code. Core in development prints each code to its console as `[email code] <address>: <code>`; elsewhere you need the inbox. Drive it only to test sign-up itself. To unlock other features, use fixture login on agent branches or vault login on a shared Neon; there is no API bootstrap.

## Sub-features

- `signup-form` shows the email step on `/signup` under **Create your account**, which emails a code, then the names and that code. **Add a password for future logins** adds a password field.
- `signup-submit` creates the user with a verified address, adds the password if one was set, and signs them in.
- `signup-landing` lands on Welcome `/` after submit (then may continue into `/setup` when the user has no workspace yet).

## How to get to it (user POV)

- Open `/signup` (or `/register`, which redirects to `/signup`).
- From sign-in, follow the **Register** link (label is Register / Registrieren — not “create account”).

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` ok and `owned_by_verify=yes`.
- Core runs in development (`NODE_ENV=development`) and you can read its output — `.cursor/verify-sokosumi-artifacts/state/logs/core.log` (or `$VERIFY_SOKOSUMI_STATE_DIR/logs/core.log`) when the launch helper started it — or you can read the inbox of the address you choose.
- Choose a unique email, e.g. `verify-$(date +%s)@sokosumi.test`, and a password meeting app rules (fixture-style `Password123!` is fine).

- **Open form.** Run `agent-browser open $WEB_URL/signup`, wait until the snapshot shows the **Email** textbox and **Continue with Email** (a too-early snapshot can be empty or `about:blank` right after `close`). Google / Microsoft sit **below** the email step — ignore them.
- **Cookie banner.** If **Accept all** / consent UI covers the form, dismiss it first — it can block clicks on the form.
- **Step 1, email.** Under **Create your account** and its subtitle sits one underlined field, `textbox "Email"` (`[data-testid="auth-field-email"]`, placeholder as its only visible name); **Already have an account? Log in** sits in the links row under the providers. Fill the field and click **Continue with Email**. The click asks Core (`POST /auth/sign-up/email-status`, behind the security check) whether the address already has an account. An invalid address shows an inline error and the step stays; an address that has an account leaves for Log in (`/signin`) on its second step, an invitation's too, so pick a fresh address. With an invitation the address is read-only and the subtitle reads "You're joining through an invitation."
- **Step 2, names and code.** Re-snapshot and wait for the title **Set up your account**, "We sent a 6-digit code to" and the address as a rounded chip (`[data-testid="auth-email-chip"]`; pressing it returns to step 1, an invitation's address is a static chip). Under it sit two underlined fields side by side, `textbox "First name"` / `"Last name"` (`[data-testid="auth-field-first-name|last-name"]`, placeholders as their only visible names), then six underlined digit slots (`textbox "Code from the email"`, no visible label). To sign up with a password, click **Add a password for future logins** in the links row under the step (beside the resend countdown) and fill the underlined `"Password"` (`[data-testid="auth-field-password"]`) that appears above the digits; the code is still required. Get the code with `grep '\[email code\] <address>' <core.log>` (the last match is current) and type it into the code field. The sixth digit does not submit: only **Register** sends the names, the optional password, the code and the updates opt-in. The only checkbox is the optional updates one ("I would like to receive updates and news"), under **Register**; there is no terms checkbox, a notice under the form says creating the account accepts them. Missing names, a short code, a refused code and an address that has an account by now (with a **Log in** link) show in one error line between the digits and **Register** (`role="alert"`), and the refused fields turn red. **Register**'s spinner is the only progress.
- **Submit.** **Click** the Register `@eN` ref (not bare `@N`); if `agent-browser get box` shows it past the viewport, run `agent-browser scrollintoview @eN` first. Prefer click over Enter. Wait for navigation away from `/signup` to **Welcome `/`**. Signup has **no** `data-testid="auth-submit"` (that testid is sign-in only).
- **Confirm session.** Open `/agents`. Expect either `/agents` (workspace ready) or `/setup` (identity / temporary workspace onboarding). Must **not** bounce to `/signin`. Do not wait `networkidle` on Welcome/chat.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-up` then screenshot + snapshot of the post-signup authenticated view (`/` or `/setup` or `/agents`). Record the email in `account.txt` (no password).

### No API bootstrap

`POST /auth/sign-up/email` is closed: every account starts from the emailed code. If the UI path stays blocked, report it; do not create users another way.

## Gotchas

- A real Turnstile site key leaves the form behind a human check. Doctor reports `turnstile_site=live` and warns. Solving that challenge is not something an agent should do — replace `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web/.env` with `1x00000000000000000000AA` (and the Core secret with the matching 1x value). `pnpm env:bootstrap` will not overwrite a key that is already set. Symptom: credentials are filled correctly, submit no-ops, and the snapshot shows an unchecked `Bestätigen Sie, dass Sie ein Mensch sind` checkbox inside a Cloudflare iframe.
- Already-authenticated sessions redirect `/signup` into the app (Welcome `/`). Clear cookies or sign out before driving the form.
- New signups without a personal workspace often hit `/setup` after leaving `/` — that is auth success, not a failed landing.
- The code proves the address; no separate verification email follows.
- With placeholder credentials Core sends no email; read the code from Core's console instead (development only). OAuth does not work.
- Do not reuse an email that already exists; pick a fresh address per run.
- On cloud-agent branches, prefer fixtures over signup unless testing signup itself. On a coworker / shared Neon, prefer the vault over creating another disposable user.
- Origin must be `$WEB_URL` for Core auth API calls (`INVALID_ORIGIN` otherwise).
- **Register** can sit below the default viewport on a short screen. Clicking the snapshot ref without `scrollintoview` is a no-op; scroll the button into view first.
