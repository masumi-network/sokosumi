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

- **Open form.** Run `agent-browser open http://localhost:3000/signin` then `agent-browser snapshot -i`. The page exposes `[data-testid="auth-field-email"]` and `[data-testid="auth-field-currentPassword"]` (locale may label fields `E-Mail` / `Passwort`).
- **Fill credentials.** Either `agent-browser auth login sokosumi` (vault) or `agent-browser fill '[data-testid="auth-field-email"]' "<email>"` and `agent-browser fill '[data-testid="auth-field-currentPassword"]' "<password>"`.
- **Submit.** Wait briefly after fill, then `agent-browser press Enter` and `agent-browser wait --load networkidle`. URL leaves `/signin` (typically `/chat`). Snapshot shows authenticated chrome (e.g. welcome heading, nav links).
- **Persist.** Run `agent-browser open http://localhost:3000/agents` then `agent-browser wait --load networkidle`. URL stays on `/agents` (not bounced to `/signin`).
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-in`, save `snapshot -i` to `after-login.snapshot.txt`, run `agent-browser screenshot`, copy newest `~/.agent-browser/tmp/screenshots/*.png` to `after-login.png`. Artifacts show authenticated UI, not the sign-in form.

## Gotchas

- Clicking `[data-testid="auth-submit"]` after vault fill can no-op; always submit with Enter after a short wait.
- OAuth buttons are not valid verification paths with placeholder credentials.
- Wrong password leaves the user on `/signin`; do not treat a soft error toast alone as success.
- Fixtures exist only on cloud-agent Neon branches — otherwise use [Sign up](./sign-up.md) first.
- `127.0.0.1` can break auth cookies/origin; stick to `localhost`.
