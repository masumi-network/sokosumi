# Sign up

Sign up creates a disposable email/password account when cloud-agent fixtures are unavailable and there is no coworker vault (`agent-browser auth list` has no `sokosumi` profile). Use this only to unlock other features — not as a substitute for fixture login on agent branches or vault login on a shared Neon.

## Sub-features

- `signup-form` shows registration fields on `/signup`.
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

- **Open form.** Run `agent-browser open $WEB_URL/signup`, wait until the snapshot shows Name / Email / Password textboxes (a too-early snapshot can be empty or `about:blank` right after `close`). Google / Microsoft / Magic Link sit **above** the email form — ignore them (same trap as sign-in).
- **Cookie banner.** If **Accept all** / consent UI covers the form, dismiss it first — it can block the terms checkbox click.
- **Fill required fields.** Prefer refs from that **fresh** snapshot (`textbox "Name"` / `"Email"` / `"Password"`). CSS `[data-testid="auth-field-name|email|password"]` works once the form is interactive; they fail if you fill before the fields appear. Optional marketing checkbox can stay unchecked.
- **Accept terms.** Prefer `agent-browser check` on the snapshot checkbox ref (accessible name about Terms / Nutzungsbedingungen). `#termsAccepted` often fails when an overlay covers the input. Submit stays **disabled** until terms are accepted.
- **Submit.** When `Register` / `Registrieren` is enabled, **click** the snapshot ref (`@eN`, not bare `@N` — agent-browser needs the `e` prefix). Prefer click over Enter — Enter can leave the form unchanged. Wait for navigation away from `/signup` to **Welcome `/`**. Signup has **no** `data-testid="auth-submit"` (that testid is sign-in only).
- **Confirm session.** Open `/agents`. Expect either `/agents` (workspace ready) or `/setup` (identity / temporary workspace onboarding). Must **not** bounce to `/signin`. Do not wait `networkidle` on Welcome/chat.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-up` then screenshot + snapshot of the post-signup authenticated view (`/` or `/setup` or `/agents`). Record the email in `account.txt` (no password).

### Bootstrap when UI checkbox will not toggle

Prefer `agent-browser check` on the terms checkbox (accessible name about Terms / Nutzungsbedingungen). If that still leaves `checked=false` / submit disabled, bootstrap the user via Better Auth then prove [Sign in](./sign-in.md) in the browser:

```bash
curl -sS -X POST "$CORE_URL/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H "origin: $WEB_URL" \
  -d '{"email":"<unique>@sokosumi.test","password":"Password123!","name":"Verify Agent","termsAccepted":true}'
```

Require HTTP 200 and a `user.email` in the body. Do **not** count API signup alone as UI signup proof — only as account creation so sign-in can be driven. Report the checkbox gap if the UI path was the intended entry.

## Gotchas

- Already-authenticated sessions redirect `/signup` into the app (Welcome `/`). Clear cookies or sign out before driving the form.
- New signups without a personal workspace often hit `/setup` after leaving `/` — that is auth success, not a failed landing.
- Email verification is off in local/core config — do not wait for a verification email. A “confirm email” banner after login is OK.
- OAuth and magic-link signup paths are invalid with placeholder credentials.
- Do not reuse an email that already exists; pick a fresh address per run.
- On cloud-agent branches, prefer fixtures over signup unless testing signup itself. On a coworker / shared Neon, prefer the vault over creating another disposable user.
- Origin must be `$WEB_URL` for Core auth API calls (`INVALID_ORIGIN` otherwise).
- Submit button stays disabled until terms are accepted.
