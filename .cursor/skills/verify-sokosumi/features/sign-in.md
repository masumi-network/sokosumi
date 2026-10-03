# Sign in

Sign in lets a user authenticate with email and password (or an emailed code), reach the authenticated app, and confirm the session survives a reload of a protected route.

## Sub-features

- `signin-form` asks for the email on `/signin`, checks it has an account, then asks for the code or the password on a second step.
- `signin-submit` creates a session via Enter submit on the password step.
- `signin-landing` lands on the authenticated default (**Welcome `/`**, or a `returnUrl` when present). Users without a ready workspace are then gated to `/setup`.
- `signin-persist` keeps the session after reload of a protected URL.

## How to get to it (user POV)

- Open `/signin` (or `/login`, which redirects to `/signin`).
- From a gated page, the app redirects to `/signin?returnUrl=…`. Some client flows `router.push('/signin')` (often without `returnUrl`) rather than an in-place login modal.

## Driving it with agent-browser

Preconditions:

- `verify-sokosumi doctor` reports `doctor ok` and `owned_by_verify=yes`.
- Cloud-agent Neon: doctor should show `fixture_auth=ok` for `alice@sokosumi.test`. If it fails, re-run `node scripts/cloud-agent-db/provision.mjs` (or seed auth fixtures) — only on `cloud-agent-*` branches.
- Coworker / shared Neon: doctor will show `fixture_auth=fail`. Use the vault (`sign-in --method vault` or `auto` fallback). Do **not** seed Alice onto that database. If there is no vault profile, create a disposable user via [Sign up](./sign-up.md).
- `turnstile_site=test-pass` or `turnstile_site=off` in doctor, with `turnstile_secret` either `test-pass` or `off`. `test-block` / `test-interactive` / `live` all stop browser sign-in, the last two behind a “confirm you are human” widget an agent must **not** answer; a `live` secret under a `test-pass` site key instead makes Core 403 the dummy token. `fixture_auth=ok` reports success through every one of these, because the harness POSTs Core's sign-in endpoint with a dummy token and never sees the widget. `pnpm env:bootstrap` only fills a **commented-out** key; a live key already set in `.env` must be replaced with the 1x always-passes values in `apps/web/.env.example` / `apps/core/.env.example`.
- Credentials available: fixture `alice@sokosumi.test` / `Password123!`, coworker vault `agent-browser auth login sokosumi`, or a user created via [Sign up](./sign-up.md).
- `AGENT_BROWSER_SESSION_NAME=sokosumi` is set (harness aliases it to `AGENT_BROWSER_SESSION` when that env is unset).
- `agent-browser` on `PATH` (`npm i -g agent-browser && agent-browser install`).

### Preferred: harness

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-$AGENT_BROWSER_SESSION_NAME}"
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in
# admin UI: … sign-in --admin
# coworker / shared Neon: … sign-in --method vault
# skip flaky UI (fixtures only): … sign-in --method cookie
# UI-only proof of signin-submit (fixtures only): … sign-in --method ui
```

`auto` (default) probes the fixture. If Core accepts it: UI Enter-submit, and cookie bootstrap **only if UI fails**. If Core rejects it: the harness types the vault profile's username on step 1, then `agent-browser auth login --no-navigate` fills the hidden username and the password testids on step 2, then persist on `/agents`. Writes `.cursor/verify-sokosumi-artifacts/sign-in/` (`after-login.snapshot.txt`, `after-login.png`, `account.txt`, `method.txt` = `ui` | `cookie` | `vault`). For feature proof of `signin-submit`, require `method=ui` in that dir (cookie/vault unlock the rest of the map).

### Manual UI recipe

- **Open form.** Run `agent-browser open $WEB_URL/signin` then `agent-browser snapshot -i`. Step 1 is one email field (`[data-testid="auth-field-email"]`, label `Email` / `E-Mail`) with **Continue with Email**, then Google / Microsoft / Passkey under "or" — ignore those.
- **Continue.** `agent-browser fill '[data-testid="auth-field-email"]' <email>`, wait ~400ms, `agent-browser press Enter`. Core checks the address (`/sign-up/email-status`, behind the captcha). An address without an account shows **No account for this address** with **Create account** instead of step 2. Create account sends the sign-up code, then opens `/signup` on its second step (name and code). In development that code is Core's console line `[email code] <address>: <code>`, not an inbox message, when the Resend key is a placeholder.
- **Step 2.** It opens on the password, and sends no code, when the account has a password (including after `cookies clear`) or when this browser last signed in with a password (`last_used_login_method` cookie `email`). Otherwise it opens on the code step, which Continue has sent (same console line in development): the title **Check your email**, "We sent a 6-digit code to" and the address as a rounded chip (pressing it returns to step 1; an invitation's address is a static chip). Under the chip sit six underlined digit slots (`textbox "Code from the email"`, no visible label) and no button: the sixth digit logs in. A status line under the slots appears only for **Checking the code…**, a refusal (the slots shake and clear) or **Code accepted. Logging you in…**. The links row underneath holds the resend countdown (**Send a new code in 30s**, then a link) and `[data-testid="auth-use-password"]` (**Use a password**), which switches in place. A Register hand-over says why on the line between the chip and the slots. The password step uses the same layout: **Enter your password**, "Logging in as" and the chip, then one underlined password field (`[data-testid="auth-field-currentPassword"]`, accessible name and placeholder `Password`, with a show/hide control) and **Log in** (`[data-testid="auth-submit"]`), whose spinner is the only progress and stays while the page leaves. A wrong password shows in an error line between the field and the button (`role="alert"`), not a toast. Its links row holds **Forgot password?** and **Email me a code**, which sends one and switches; if Continue already sent a code it reads **Use the code** and switches without another. The confirmed address sits in a hidden `[data-testid="auth-field-username"]` for password managers and the vault. Prefer CSS testids over snapshot refs.
- **Fill credentials.** Either `agent-browser auth login sokosumi --no-navigate --username-selector '[data-testid="auth-field-username"]' --password-selector '[data-testid="auth-field-currentPassword"]'` (vault, on step 2) or `agent-browser fill` the password testid.
- **Submit.** Wait briefly after fill (~400ms), then `agent-browser press Enter` if still on `/signin`. Expect a full document load straight to Welcome `/` (or `returnUrl`); there is no callback hop for credential login. The leave waits for the session first (~200ms plus a `getSession`), so give it a condition poll, not a fixed sleep. Do **not** `wait --load networkidle` here; Ably can hang that wait on chat-adjacent shells.
- **Persist.** Run `agent-browser open $WEB_URL/agents` then `agent-browser wait --url "**/agents"`. URL stays on `/agents` (not bounced to `/signin`). Snapshot authenticated chrome there. Fixture users with a workspace should land on the coworker gallery; brand-new users may hit `/setup` instead — that still proves auth if not `/signin`.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/sign-in`, save `snapshot -i` to `after-login.snapshot.txt`, run `agent-browser screenshot`, copy newest `~/.agent-browser/tmp/screenshots/*.png` to `after-login.png`. Artifacts show authenticated UI, not the sign-in form.

### Cookie bootstrap when UI login fails

Use when Enter-submit stays on `/signin`, or the app briefly leaves `/signin` then bounces back (production `BETTER_AUTH_COOKIE_DOMAIN`, or OAuth/passkey stole the interaction). Doctor fails when `.env` scopes cookies to a production host (`sokosumi.com`). Comment that out for classic `:3000`/`:8787`. Named portless stacks inject `BETTER_AUTH_COOKIE_DOMAIN=sokosumi.localhost` at process env — do not comment that away; Web `proxy` session gate needs the parent domain to see Core's session cookie. Restart Core after editing `.env`, retry UI. If UI still fails after env fix, prefer the harness:

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

Computer-use notes (live-proved):

- **Do not invent users.** Run `verify-sokosumi credentials-status` (or doctor). If `verify_credentials_email=unset`, stop and report missing `VERIFY_SOKOSUMI_*` secrets — do not create `you-*@sokosumi.test` accounts for general UI proof.
- **Prefer harness auth first:** `verify-sokosumi sign-in` (agent-browser) reads `VERIFY_SOKOSUMI_EMAIL` / `VERIFY_SOKOSUMI_PASSWORD` from the process env. Computer-use should drive post-login UI. Typing a Runtime Secret password in the GUI fails because tool output redacts it as `[REDACTED]`.
- If you must type the form: use `$VERIFY_SOKOSUMI_EMAIL` (must be an Environment Variable, not Runtime Secret) and only a non-redacted password. Type the email into the one field on step 1 and press Enter. On step 2, click **Use a password** when the code slots show, then type the password.
- **Type** email and password with real keystrokes (or the GUI type tool). Setting `input.value` via JS / paste-without-events often leaves react-hook-form empty so zod blocks submit (Login stays enabled — it only disables while `isSubmitting` or `isLeaving`).
- Submit with **Enter** (or the **Log in** button under the password).
- After success, Chrome may show a **“Save password?”** bubble over the app — dismiss **Never** / **No thanks** before clicking app chrome, or clicks miss.
- When computer-use keeps failing, run `verify-sokosumi sign-in --method cookie` (agent-browser), then continue the map.

## Gotchas

- Prefer `verify-sokosumi sign-in` over ad-hoc clicks — most cloud-agent failures are OAuth/passkey focus steal, submit-click races, missing fixtures, or cookie-domain traps.
- Only OAuth passes through `/auth/callback/signin`; credential, passkey and email code finish in place and then replace the document. Harness `wait_leave_auth_page` polls until the URL is off both the auth entry pages and the callback path; `assert_authed_url` still allows `/auth/callback/`.
- Clicking `[data-testid="auth-submit"]` after vault fill can no-op; always submit with Enter after a short wait.
- OAuth and passkey are not valid verification paths with placeholder credentials. An email code is: in development Core prints it to its console as `[email code] <address>: <code>`. An account with a password opens on the password and sends no code. Passkey also runs conditional mediation (`autoFill`) when the browser supports it — that can steal focus from the email field (`autoComplete="username webauthn"`).
- Wrong password / missing fixtures leave the user on `/signin` (Core returns non-2xx). Doctor `fixture_auth=fail` on a **cloud-agent** branch means provision/seed first. On a **coworker / shared Neon** it means use the vault or [Sign up](./sign-up.md) — do not seed Alice onto that database, and do not keep retrying the Alice form.
- Fixtures exist only on cloud-agent Neon branches.
- `127.0.0.1` can break auth cookies/origin; stick to `localhost`.
- A real Turnstile site key leaves the form behind a human check. Doctor reports `turnstile_site=live` and warns. Solving that challenge is not something an agent should do — replace `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web/.env` with `1x00000000000000000000AA` (and the Core secret with the matching 1x value). `pnpm env:bootstrap` will not overwrite a key that is already set. Symptom: credentials are filled correctly, submit no-ops, and the snapshot shows an unchecked `Bestätigen Sie, dass Sie ein Mensch sind` checkbox inside a Cloudflare iframe.
- `BETTER_AUTH_COOKIE_DOMAIN` set to a production host (default in Core `.env.example`) breaks localhost and `*.sokosumi.localhost` sessions — comment it out of `.env` before driving. Doctor fails when this trap is present. Portless still sets `sokosumi.localhost` in the process env; that is required, not a trap.
- Browser auth client posts to Core (`$CORE_URL/auth`). Cookie inject must target the `$WEB_URL` hostname, not `127.0.0.1`.
