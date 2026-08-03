# Sign in

Sign in lets a user authenticate with email and password, reach the authenticated app, and confirm the session survives a reload of a protected route.

## Sub-features

- `signin-form` shows email and password fields on `/signin`.
- `signin-submit` creates a session via Enter submit.
- `signin-landing` lands on the authenticated default (`/chat` or redirect chain into the app).
- `signin-persist` keeps the session after reload of a protected URL.

## How to get to it (user POV)

- Open `/signin` (or `/login`, which redirects to `/signin`).
- From a gated page, follow the sign-in prompt to `/signin`.

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` reports `doctor ok` and `owned_by_verify=yes`.
- Credentials available: fixture `alice@sokosumi.test` / `Password123!`, or a coworker vault `agent-browser auth login sokosumi`, or a user created via [Sign up](./sign-up.md).
- `AGENT_BROWSER_SESSION_NAME=sokosumi` is set.

- **Open form.** Run `agent-browser open http://localhost:3000/signin` then `agent-browser snapshot -i`. The page exposes `[data-testid="auth-field-email"]` and `[data-testid="auth-field-currentPassword"]` (locale may label fields `E-Mail` / `Passwort`). Google / Microsoft / Passkey / Magic Link sit **above** the password form — ignore them.
- **Fill credentials.** Either `agent-browser auth login sokosumi` (vault) or `agent-browser fill '[data-testid="auth-field-email"]' "<email>"` and `agent-browser fill '[data-testid="auth-field-currentPassword"]' "<password>"`. Prefer CSS testids over snapshot refs so OAuth buttons are not selected by accident.
- **Submit.** Wait briefly after fill, then `agent-browser press Enter` and `agent-browser wait --load networkidle`. URL leaves `/signin` (client often hits `/` then lands on `/chat`). Snapshot shows authenticated chrome (e.g. welcome heading, nav links).
- **Persist.** Run `agent-browser open http://localhost:3000/agents` then `agent-browser wait --load networkidle`. URL stays on `/agents` (not bounced to `/signin`).
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-in`, save `snapshot -i` to `after-login.snapshot.txt`, run `agent-browser screenshot`, copy newest `~/.agent-browser/tmp/screenshots/*.png` to `after-login.png`. Artifacts show authenticated UI, not the sign-in form.

### Cookie bootstrap when UI login fails

Use when Enter-submit stays on `/signin`, or the app briefly leaves `/signin` then bounces back (almost always `BETTER_AUTH_COOKIE_DOMAIN` still set, or OAuth/passkey stole the interaction). Fix Core env first (`BETTER_AUTH_COOKIE_DOMAIN` commented out), restart Core, retry UI. If UI still fails after env fix:

```bash
# Capture Set-Cookie headers from Core Better Auth
curl -si -X POST "http://localhost:8787/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"email":"alice@sokosumi.test","password":"Password123!"}' \
  | tee .cursor/verify-sokosumi-artifacts/sign-in/core-signin.headers.txt
```

Require HTTP 200. Inject the session cookie(s) into the agent-browser (or computer-use) profile for `http://localhost:3000`, then `agent-browser open http://localhost:3000/agents` and prove the session. **API bootstrap alone is not UI sign-in proof** — only unlocks the rest of the map after a failed UI path; record that the UI path failed and why.

Computer-use note: same recipe. Prefer clicking only inside the password form; Google/Microsoft/Passkey/Magic Link sit above it and often capture the first click.

## Gotchas

- Clicking `[data-testid="auth-submit"]` after vault fill can no-op; always submit with Enter after a short wait.
- OAuth, magic-link, and passkey are not valid verification paths with placeholder credentials. Passkey also runs conditional mediation (`autoFill`) when the browser supports it — that can steal focus from the email field (`autoComplete="username webauthn"`).
- Wrong password leaves the user on `/signin`; do not treat a soft error toast alone as success.
- Fixtures exist only on cloud-agent Neon branches — otherwise use [Sign up](./sign-up.md) first.
- `127.0.0.1` can break auth cookies/origin; stick to `localhost`.
- `BETTER_AUTH_COOKIE_DOMAIN` set to a production host (default in Core `.env.example`) breaks localhost sessions — comment it out before driving.
