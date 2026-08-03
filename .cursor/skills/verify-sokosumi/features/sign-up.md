# Sign up

Sign up creates a disposable email/password account when cloud-agent fixtures are unavailable (typical empty local DB). Use this only to unlock other features — not as a substitute for fixture login on agent branches.

## Sub-features

- `signup-form` shows registration fields on `/signup`.
- `signup-submit` creates the user and signs them in (no email verification).
- `signup-landing` lands inside the authenticated app after submit.

## How to get to it (user POV)

- Open `/signup` (or `/register`, which redirects to `/signup`).
- From sign-in, follow the create-account link.

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` ok and `owned_by_verify=yes`.
- Fixtures unavailable or intentionally unused.
- Choose a unique email, e.g. `verify-$(date +%s)@sokosumi.test`, and a password meeting app rules (fixture-style `Password123!` is fine).

- **Open form.** Run `agent-browser open http://localhost:3000/signup` then `agent-browser snapshot -i`. Google / Microsoft / Magic Link sit **above** the email form — ignore them (same trap as sign-in).
- **Fill required fields.** Name, email, password textboxes (locale labels vary). Prefer refs from a **fresh** snapshot taken after open (stale refs fail after navigation). Optional marketing checkbox can stay unchecked.
- **Accept terms.** Prefer `agent-browser check` on the terms checkbox (accessible name about Terms / Nutzungsbedingungen, or `#termsAccepted`). Submit stays **disabled** until terms are accepted.
- **Submit.** When `Register` / `Registrieren` is enabled, **click** the submit button (prefer click over Enter — Enter can leave the form unchanged). Wait for navigation away from `/signup` (often `/` then `/chat`).
- **Confirm session.** Open `/agents` or `/chat`; must not bounce to `/signin`.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-up` then screenshot + snapshot of the post-signup authenticated view. Record the email in `account.txt` (no password).

### Bootstrap when UI checkbox will not toggle

Prefer `agent-browser check` on the terms checkbox (accessible name about Terms / Nutzungsbedingungen). If that still leaves `checked=false` / submit disabled, bootstrap the user via Better Auth then prove [Sign in](./sign-in.md) in the browser:

```bash
curl -sS -X POST "http://localhost:8787/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"email":"<unique>@sokosumi.test","password":"Password123!","name":"Verify Agent","termsAccepted":true}'
```

Require HTTP 200 and a `user.email` in the body. Do **not** count API signup alone as UI signup proof — only as account creation so sign-in can be driven. Report the checkbox gap if the UI path was the intended entry.

## Gotchas

- Already-authenticated sessions redirect `/signup` into the app (`/chat`). Clear cookies or sign out before driving the form.
- Email verification is off in local/core config — do not wait for a verification email. A “confirm email” banner after login is OK.
- OAuth and magic-link signup paths are invalid with placeholder credentials.
- Do not reuse an email that already exists; pick a fresh address per run.
- On cloud-agent branches, prefer fixtures over signup unless testing signup itself.
- Origin must be `http://localhost:3000` for Core auth API calls (`INVALID_ORIGIN` otherwise).
- Submit button stays disabled until terms are accepted.
