/**
 * Feedback loop for SOK-752 (iOS PWA session dies after short background).
 *
 * Better Auth: rememberMe:false → session_token Set-Cookie with no Max-Age
 * (browser session cookie). iOS kills the installed PWA process after a few
 * minutes in background and drops session cookies; Android/desktop keep the
 * process (or persistent cookies) alive much longer.
 *
 * This loop goes RED when SignInForm defaults rememberMe to false.
 *
 *   node scripts/debug/pwa-session-cookie-max-age-loop.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const formSource = readFileSync(
  join(root, "apps/web/src/app/(auth)/signin/components/form.tsx"),
  "utf8",
);

const rememberMeMatch = formSource.match(
  /defaultValues:\s*\{[\s\S]*?rememberMe:\s*(true|false)/,
);
if (!rememberMeMatch) {
  console.error("RED: could not find SignInForm defaultValues.rememberMe");
  process.exit(1);
}

const formDefaultRememberMe = rememberMeMatch[1] === "true";
// Mirrors better-auth setSessionCookie: dontRememberMe ? undefined : expiresIn
const SESSION_EXPIRES_IN_SEC = 60 * 60 * 24 * 7;
const effectiveMaxAge = formDefaultRememberMe
  ? SESSION_EXPIRES_IN_SEC
  : undefined;

const DAY = 60 * 60 * 24;
const ok = typeof effectiveMaxAge === "number" && effectiveMaxAge >= DAY;

console.log("form default rememberMe:", formDefaultRememberMe);
console.log(
  "effective session_token Max-Age:",
  effectiveMaxAge ?? "(none — session cookie)",
);
console.log(
  ok
    ? "GREEN: persistent cookie (survives iOS PWA process kill)"
    : "RED: non-persistent session cookie (iOS PWA death mode)",
);
process.exit(ok ? 0 : 1);
