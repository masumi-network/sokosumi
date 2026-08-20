# Sign in

Sign in lets a user authenticate with email and password, reach the authenticated app, and confirm the session survives a reload of a protected route.

## Sub-features

- `signin-form` shows email and password fields on `/signin`.
- `signin-submit` creates a session via Enter submit.
- `signin-landing` lands on the authenticated default (`/chat` or redirect chain into the app).
- `signin-persist` keeps the session after reload of a protected URL.

## How to get to it (user POV)

- Open `/signin` (or `/login`, which redirects to `/signin`).
- From a gated page, the app redirects to `/signin?returnUrl=…` (some client flows also show a Login modal).

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` reports `doctor ok` and `owned_by_verify=yes`.
- Cloud-agent Neon: doctor should show `fixture_auth=ok` for `alice@sokosumi.test`. If it fails, re-run `node scripts/cloud-agent-db/provision.mjs` (or seed auth fixtures) — only on `cloud-agent-*` branches.
- Coworker / shared Neon: doctor will show `fixture_auth=fail`. Use the vault (`sign-in --method vault` or `auto` fallback). Do **not** seed Alice onto that database. If there is no vault profile, create a disposable user via [Sign up](./sign-up.md).
- Credentials available: fixture `alice@sokosumi.test` / `Password123!`, coworker vault `agent-browser auth login sokosumi`, or a user created via [Sign up](./sign-up.md).
- `AGENT_BROWSER_SESSION_NAME=sokosumi` is set.
- `agent-browser` on `PATH` (`npm i -g agent-browser && agent-browser install`).

### Preferred: harness

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in
# admin UI: … sign-in --admin
# coworker / shared Neon: … sign-in --method vault
# skip flaky UI (fixtures only): … sign-in --method cookie
# UI-only proof of signin-submit (fixtures only): … sign-in --method ui
```

`auto` (default) probes the fixture. If Core accepts it: UI Enter-submit, then cookie bootstrap. If Core rejects it: coworker vault `agent-browser auth login` with the email/password testids, then persist on `/agents`. Writes `.cursor/verify-sokosumi-artifacts/sign-in/` (`after-login.snapshot.txt`, `account.txt`, `method.txt` = `ui` | `cookie` | `vault`). For feature proof of `signin-submit`, require `method=ui` in that dir (cookie/vault unlock the rest of the map).

### Manual UI recipe

- **Open form.** Run `agent-browser open $WEB_URL/signin` then `agent-browser snapshot -i`. The page exposes `[data-testid="auth-field-email"]` and `[data-testid="auth-field-currentPassword"]` (locale may label fields `E-Mail` / `Passwort`). Google / Microsoft / Passkey / Magic Link sit **above** the password form — ignore them.
- **Fill credentials.** Either `agent-browser auth login sokosumi --username-selector '[data-testid="auth-field-email"]' --password-selector '[data-testid="auth-field-currentPassword"]'` (vault) or `agent-browser fill` those same testids. Prefer CSS testids over snapshot refs so OAuth buttons are not selected by accident.
- **Submit.** Wait briefly after fill (~400ms), then `agent-browser press Enter` if still on `/signin`. Do **not** `wait --load networkidle` here — post-login often lands on `/chat` and Ably hangs that wait.
- **Persist.** Run `agent-browser open $WEB_URL/agents` then `agent-browser wait --url "**/agents"`. URL stays on `/agents` (not bounced to `/signin`). Snapshot authenticated chrome there.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-in`, save `snapshot -i` to `after-login.snapshot.txt`, run `agent-browser screenshot`, copy newest `~/.agent-browser/tmp/screenshots/*.png` to `after-login.png`. Artifacts show authenticated UI, not the sign-in form.

### Cookie bootstrap when UI login fails

Use when Enter-submit stays on `/signin`, or the app briefly leaves `/signin` then bounces back (production `BETTER_AUTH_COOKIE_DOMAIN`, or OAuth/passkey stole the interaction). Doctor fails when `.env` scopes cookies to a production host (`sokosumi.com`). Comment that out for classic `:3000`/`:8787`. Named portless stacks inject `BETTER_AUTH_COOKIE_DOMAIN=sokosumi.localhost` at process env — do not comment that away; Web middleware needs the parent domain to see Core's session cookie. Restart Core after editing `.env`, retry UI. If UI still fails after env fix, prefer the harness:

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in --method cookie
```

Manual equivalent (prefer the harness — it percent-decodes values and sets
`HttpOnly` + `SameSite=Lax`, plus `Secure` when `$WEB_URL` is https. Raw
`agent-browser cookies set --curl` often fails CDP with “Invalid cookie fields”
on Better Auth’s dotted cookie names / large `session_data`):

```bash
# Prefer:
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in --method cookie

# Under the hood: POST Core → parse Set-Cookie → agent-browser cookies set
# for sokosumi-localhost-preprod.session_token (+ session_data) on the $WEB_URL host.
```

Cookie names on local Preprod: `sokosumi-localhost-preprod.session_token` (required),
`sokosumi-localhost-preprod.session_data` (short-lived cache). On portless they
use `Domain=sokosumi.localhost` so Web and Core share them. Classic `pnpm web:dev`
is host-scoped on `localhost`.

**API bootstrap alone is not UI sign-in proof** — only unlocks the rest of the map after a failed UI path; record that the UI path failed and why (`method=cookie` in artifacts).

Computer-use notes (live-proved with `alice@sokosumi.test`):

- Scroll past Google / Microsoft / Passkey / Magic Link. Magic Link also has its **own** email field + “Send me a Magic Link” — do **not** type there. Target fields under **“OR SIGN IN WITH PASSWORD”** only.
- **Type** email and password with real keystrokes (or the GUI type tool). Setting `input.value` via JS / paste-without-events often leaves react-hook-form empty so zod blocks submit (Login stays enabled — it only disables while `isSubmitting`).
- Submit with **Enter** (or the purple **Login** button under the password form).
- After success, Chrome may show a **“Save password?”** bubble over the app — dismiss **Never** / **No thanks** before clicking app chrome, or clicks miss.
- When computer-use keeps failing, run `verify-sokosumi sign-in --method cookie` (agent-browser), then continue the map.

## Gotchas

- Prefer `verify-sokosumi sign-in` over ad-hoc clicks — most cloud-agent failures are OAuth/passkey focus steal, submit-click races, missing fixtures, or cookie-domain traps.
- Clicking `[data-testid="auth-submit"]` after vault fill can no-op; always submit with Enter after a short wait.
- OAuth, magic-link, and passkey are not valid verification paths with placeholder credentials. Passkey also runs conditional mediation (`autoFill`) when the browser supports it — that can steal focus from the email field (`autoComplete="username webauthn"`).
- Wrong password / missing fixtures leave the user on `/signin` (Core returns non-2xx). Doctor `fixture_auth=fail` on a **cloud-agent** branch means provision/seed first. On a **coworker / shared Neon** it means use the vault or [Sign up](./sign-up.md) — do not seed Alice onto that database, and do not keep retrying the Alice form.
- Fixtures exist only on cloud-agent Neon branches.
- `127.0.0.1` can break auth cookies/origin; stick to `localhost`.
- `BETTER_AUTH_COOKIE_DOMAIN` set to a production host (default in Core `.env.example`) breaks localhost and `*.sokosumi.localhost` sessions — comment it out of `.env` before driving. Doctor fails when this trap is present. Portless still sets `sokosumi.localhost` in the process env; that is required, not a trap.
- Browser auth client posts to Core (`$CORE_URL/auth`). Cookie inject must target the `$WEB_URL` hostname, not `127.0.0.1`.
