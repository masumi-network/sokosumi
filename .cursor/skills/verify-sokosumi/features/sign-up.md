# Sign up

Sign up creates a disposable email/password account when cloud-agent fixtures are unavailable and there is no coworker vault (`agent-browser auth list` has no `sokosumi` profile). Use this only to unlock other features — not as a substitute for fixture login on agent branches or vault login on a shared Neon.

## Sub-features

- `signup-form` shows the email step on `/signup`, then name and password for that email.
- `signup-submit` creates the user and signs them in (no email verification).
- `signup-landing` lands on Welcome `/` after submit (then may continue into `/setup` when the user has no workspace yet).

## How to get to it (user POV)

- Open `/signup` (or `/register`, which redirects to `/signup`).
- From sign-in, follow the **Register** link (label is Register / Registrieren — not “create account”).

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` ok and `owned_by_verify=yes`.
- Fixtures unavailable or intentionally unused. Prefer `verify-sokosumi sign-in --method vault` when a `sokosumi` profile exists.
- Choose a unique email, e.g. `verify-$(date +%s)@sokosumi.test`, and a password meeting app rules (fixture-style `Password123!` is fine).

- **Open form.** Run `agent-browser open $WEB_URL/signup`, wait until the snapshot shows the **Email** textbox and **Continue with email** (a too-early snapshot can be empty or `about:blank` right after `close`). Google / Microsoft sit **below** the email step — ignore them.
- **Cookie banner.** If **Accept all** / consent UI covers the form, dismiss it first — it can block clicks on the form.
- **Step 1, email.** Fill `textbox "Email"` (`[data-testid="auth-field-email"]`) and click **Continue with email**. This step sends nothing to Core; an invalid address shows an inline error and the step stays.
- **Step 2, name and password.** Re-snapshot and wait for `textbox "First name"` / `"Last name"` / `"Password"` (`[data-testid="auth-field-firstName|lastName|password"]`). The header reads "Registering as <email>". **Send me a Magic Link** sits below the form — ignore it. The only checkbox is the optional marketing one; there is no terms checkbox, a notice under the form says creating the account accepts them.
- **Submit.** **Click** the Register `@eN` ref (not bare `@N`); if `agent-browser get box` shows it past the viewport, run `agent-browser scrollintoview @eN` first. Prefer click over Enter. Wait for navigation away from `/signup` to **Welcome `/`**. Signup has **no** `data-testid="auth-submit"` (that testid is sign-in only).
- **Confirm session.** Open `/agents`. Expect either `/agents` (workspace ready) or `/setup` (identity / temporary workspace onboarding). Must **not** bounce to `/signin`. Do not wait `networkidle` on Welcome/chat.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-up` then screenshot + snapshot of the post-signup authenticated view (`/` or `/setup` or `/agents`). Record the email in `account.txt` (no password).

### Bootstrap when the form cannot be driven

If the UI path stays blocked, bootstrap the user via Better Auth then prove [Sign in](./sign-in.md) in the browser:

```bash
curl -sS -X POST "$CORE_URL/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H "origin: $WEB_URL" \
  -H 'x-captcha-response: XXXX.DUMMY.TOKEN.XXXX' \
  -d '{"email":"<unique>@sokosumi.test","password":"Password123!","firstName":"Verify","lastName":"Agent","termsAccepted":true}'
```

Require HTTP 200 and a `user.email` in the body. Do **not** count API signup alone as UI signup proof — only as account creation so sign-in can be driven. Report the UI gap if the UI path was the intended entry.

## Gotchas

- A real Turnstile site key leaves the form behind a human check. Doctor reports `turnstile_site=live` and warns. Solving that challenge is not something an agent should do — replace `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web/.env` with `1x00000000000000000000AA` (and the Core secret with the matching 1x value). `pnpm env:bootstrap` will not overwrite a key that is already set. Symptom: credentials are filled correctly, submit no-ops, and the snapshot shows an unchecked `Bestätigen Sie, dass Sie ein Mensch sind` checkbox inside a Cloudflare iframe. API signup also needs `x-captcha-response: XXXX.DUMMY.TOKEN.XXXX` once the Core secret is set.
- Already-authenticated sessions redirect `/signup` into the app (Welcome `/`). Clear cookies or sign out before driving the form.
- New signups without a personal workspace often hit `/setup` after leaving `/` — that is auth success, not a failed landing.
- Email verification is off in local/core config — do not wait for a verification email. A “confirm email” banner after login is OK.
- OAuth and magic-link signup paths are invalid with placeholder credentials.
- Do not reuse an email that already exists; pick a fresh address per run.
- On cloud-agent branches, prefer fixtures over signup unless testing signup itself. On a coworker / shared Neon, prefer the vault over creating another disposable user.
- Origin must be `$WEB_URL` for Core auth API calls (`INVALID_ORIGIN` otherwise).
- **Register** can sit below the default viewport on a short screen. Clicking the snapshot ref without `scrollintoview` is a no-op; scroll the button into view first.
