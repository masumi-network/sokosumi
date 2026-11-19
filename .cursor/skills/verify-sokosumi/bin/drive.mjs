#!/usr/bin/env node
// drive.mjs — sign in and run one feature journey in a throwaway Chrome, recording
// a video plus one screenshot per step. Never prints credentials.
//
//   node .cursor/skills/verify-sokosumi/bin/drive.mjs <journey> [--out DIR] [--viewport 390x844] [--headed]
//   node .cursor/skills/verify-sokosumi/bin/drive.mjs route --path /studio
//   node .cursor/skills/verify-sokosumi/bin/drive.mjs list
//
// Env: VERIFY_SOKOSUMI_WEB_URL (default http://localhost:3100),
//      VERIFY_SOKOSUMI_EMAIL / VERIFY_SOKOSUMI_PASSWORD (default: local alice fixture).
// Output (survives cleanup): .cursor/verify-sokosumi-artifacts/<journey>/<timestamp>/
//   NN-step.png, video.webm, summary.json (steps, console errors, failed requests).
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const require = createRequire(path.join(REPO, "apps/web/package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const journeyName = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const WEB = (
  process.env.VERIFY_SOKOSUMI_WEB_URL || "http://localhost:3100"
).replace(/\/$/, "");
const EMAIL = process.env.VERIFY_SOKOSUMI_EMAIL || "alice@sokosumi.test";
const PASSWORD = process.env.VERIFY_SOKOSUMI_PASSWORD || "Password123!";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

// Each journey is the real user path. A step that cannot find its control throws:
// report the failure, never weaken the journey to make it pass.
// A client redirect still in flight aborts the next goto (ERR_ABORTED); retry once.
async function open(page, route) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.goto(`${WEB}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
    } catch (error) {
      if (attempt > 1 || !/ERR_ABORTED|interrupted/.test(String(error)))
        throw error;
      await page.waitForTimeout(1500);
    }
  }
}

// The cookie banner covers the composer; decline optional cookies like a user would.
async function dismissCookies(page) {
  const reject = page.getByRole("button", { name: /Reject non-essential/i });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

const JOURNEYS = {
  "studio-composer": {
    about:
      "Content Studio composer: land, write a brief, open the Advanced model picker (Auto default), open Choose what to make. Never generates.",
    async run({ page, shot, note }) {
      await open(page, `/studio`);
      const brief = page.getByRole("textbox", {
        name: /Describe the ad you want to create/i,
      });
      await brief.waitFor({ timeout: 60_000 });
      await dismissCookies(page);
      await shot("studio-landing");
      await brief.click();
      await brief.pressSequentially(
        "Autumn coffee promo for our oat latte, warm light",
        { delay: 15 },
      );
      await shot("brief-typed");
      // Advanced model picker: Auto is the default; the full catalog sits behind it.
      const advanced = page
        .getByRole("region", { name: "New images" })
        .getByRole("button", { name: "Advanced" });
      await advanced.waitFor({ timeout: 15_000 });
      await advanced.click();
      const auto = page.getByRole("button", { name: /^Auto$/ });
      await auto.waitFor({ timeout: 10_000 });
      note(`Auto pressed=${await auto.getAttribute("aria-pressed")}`);
      await page.waitForTimeout(600); // let the popover finish fading in
      await shot("advanced-model-picker-open");
      await page.keyboard.press("Escape");
      if (
        !(await auto.waitFor({ state: "hidden", timeout: 2_000 }).then(
          () => true,
          () => false,
        ))
      ) {
        await advanced.click(); // the search box can swallow Escape; the trigger toggles it closed
        await auto.waitFor({ state: "hidden", timeout: 5_000 });
      }
      const choose = page.getByRole("button", { name: /Choose what to make/i });
      await choose.click();
      const chooser = page.getByRole("dialog", {
        name: /What do you want to make first/i,
      });
      await chooser.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(600);
      await shot("choose-what-to-make-open");
      await page.keyboard.press("Escape");
      await chooser.waitFor({ state: "hidden", timeout: 5_000 });
      await shot("composer-final");
    },
  },
  "studio-empty-state": {
    about:
      "Content Studio empty state: hero, ad wall and hero buttons; notes each button's height (use --viewport 390x844 for phone)",
    async run({ page, shot, note }) {
      await open(page, `/studio`);
      await page
        .getByRole("heading", { name: /Create your first ad/i })
        .waitFor({ timeout: 60_000 });
      await dismissCookies(page);
      await page.waitForTimeout(1500); // let the ad wall images settle
      for (const name of [
        /Start from a website/i,
        /Choose what to make/i,
        /Select project/i,
      ]) {
        const button = page.getByRole("button", { name }).first();
        if (!(await button.isVisible().catch(() => false))) {
          note(`${name.source}: not shown`);
          continue;
        }
        const box = await button.boundingBox();
        note(
          `${name.source}: height=${Math.round(box.height)} width=${Math.round(box.width)}`,
        );
      }
      const wallImages = await page.locator("img").evaluateAll((imgs) => ({
        total: imgs.length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      }));
      note(`images total=${wallImages.total} broken=${wallImages.broken}`);
      await shot("studio-empty-state");
    },
  },
  ads: {
    about: "Ads landing at /ads",
    async run({ page, shot }) {
      await open(page, `/ads`);
      await page.getByRole("heading").first().waitFor({ timeout: 60_000 });
      await dismissCookies(page);
      await shot("ads-landing");
    },
  },
  route: {
    about: "Screenshot any route: route --path /some/path",
    async run({ page, shot }) {
      const p = flag("--path") || "/";
      await open(page, `${p}`);
      await page.waitForTimeout(3000);
      await shot(
        p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root",
      );
    },
  },
};

if (!journeyName || journeyName === "list" || !JOURNEYS[journeyName]) {
  for (const [name, j] of Object.entries(JOURNEYS))
    console.log(`${name}\t${j.about}`);
  process.exit(journeyName && journeyName !== "list" ? 2 : 0);
}

const OUT = path.resolve(
  flag("--out") ||
    path.join(REPO, ".cursor/verify-sokosumi-artifacts", journeyName, STAMP),
);
const VIDEO_TMP = path.join(OUT, ".video");
mkdirSync(VIDEO_TMP, { recursive: true });

const summary = {
  journey: journeyName,
  web: WEB,
  startedAt: new Date().toISOString(),
  steps: [],
  notes: [],
  consoleErrors: [],
  failedRequests: [],
  ok: false,
};
// Fresh temp profile per run: never the user's personal Chrome profile.
const browser = await chromium.launch({
  channel: process.env.VERIFY_SOKOSUMI_CHANNEL || "chrome",
  headless: !args.includes("--headed"),
});
const [vw, vh] = (flag("--viewport") || "1440x900").split("x").map(Number);
// Reuse the last session (gitignored state dir) so repeated runs do not trip the sign-in rate limit.
const AUTH_STATE = path.join(
  REPO,
  ".cursor/verify-sokosumi-artifacts/state",
  `auth-${new URL(WEB).port || "443"}-${EMAIL.replace(/[^a-z0-9]/gi, "_")}.json`,
);
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  recordVideo: { dir: VIDEO_TMP, size: { width: vw, height: vh } },
  storageState: existsSync(AUTH_STATE) ? AUTH_STATE : undefined,
});
const page = await context.newPage();
page.on(
  "console",
  (m) =>
    m.type() === "error" && summary.consoleErrors.push(m.text().slice(0, 300)),
);
page.on(
  "response",
  (r) =>
    r.status() >= 500 &&
    summary.failedRequests.push(`${r.status()} ${r.url().split("?")[0]}`),
);

// The dev server resizes each image on first request, so a shot taken at once shows
// blank tiles. Wait for the images on screen; record the ones that never load.
async function waitForImages() {
  // A repeated tile (the Studio wall loops) counts as loaded once any copy is.
  const pending = () =>
    page.$$eval("img", (els) => {
      const src = (e) => e.currentSrc || e.src;
      const loaded = new Set(
        els.filter((e) => e.complete && e.naturalWidth > 0).map(src),
      );
      return els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const onScreen =
            r.width > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.top < innerHeight &&
            r.left < innerWidth;
          return onScreen && !loaded.has(src(e));
        })
        .map(src);
    });
  const deadline = Date.now() + 20_000;
  let left = await pending();
  while (left.length && Date.now() < deadline) {
    await page.waitForTimeout(500);
    left = await pending();
  }
  if (left.length)
    note(
      `${left.length} image(s) on screen did not load: ${left.slice(0, 3).join(", ")}`,
    );
}

let n = 0;
const shot = async (label) => {
  if (label !== "failure") {
    await dismissCookies(page); // the banner can mount late
    await waitForImages();
  }
  const file = `${String(++n).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  summary.steps.push({ file, url: page.url().replace(WEB, "") });
  console.log(`shot ${file}`);
  if (label !== "failure" && new URL(page.url()).pathname.startsWith("/signin"))
    throw new Error(`bounced to /signin at ${file}`);
};
const note = (text) => {
  summary.notes.push(text);
  console.log(`note ${text}`);
};

async function signIn() {
  if (existsSync(AUTH_STATE)) {
    // `local-stack up` starts a fresh DB, and Better Auth's cookie cache can pass a
    // dead session for minutes. Ask the server, past the cache, before reusing it.
    const res = await page.request
      .get(`${WEB}/api/auth/get-session?disableCookieCache=true`)
      .catch(() => null);
    const session = res?.ok() ? await res.json().catch(() => null) : null;
    if (session?.user) {
      await open(page, `/agents`);
      if (!new URL(page.url()).pathname.startsWith("/signin"))
        return note("reused saved session");
    }
    await context.clearCookies();
  }
  await open(page, `/signin`);
  const email = page.locator('[data-testid="auth-field-email"]');
  await email.waitFor({ timeout: 90_000 });
  await email.fill(EMAIL);
  await email.press("Enter");
  const usePassword = page.locator('[data-testid="auth-use-password"]');
  const password = page.locator('[data-testid="auth-field-currentPassword"]');
  await Promise.race([
    usePassword.waitFor({ timeout: 90_000 }),
    password.waitFor({ timeout: 90_000 }),
  ]);
  if (await usePassword.isVisible().catch(() => false))
    await usePassword.click();
  await password.waitFor({ timeout: 15_000 });
  await password.fill(PASSWORD);
  await password.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"), {
    timeout: 60_000,
  });
  await open(page, `/agents`);
  if (new URL(page.url()).pathname.startsWith("/signin"))
    throw new Error("session did not persist (bounced to /signin)");
  await context.storageState({ path: AUTH_STATE });
  note(`signed in (fixture=${!process.env.VERIFY_SOKOSUMI_EMAIL})`);
}

try {
  if (!args.includes("--no-sign-in")) {
    // Step 2 of /signin occasionally never opens on a cold dev server; one fresh retry.
    await signIn().catch(async (error) => {
      note(`sign-in retry after: ${String(error.message).split("\n")[0]}`);
      await signIn();
    });
  }
  await JOURNEYS[journeyName].run({ page, shot, note });
  summary.ok = true;
} catch (error) {
  summary.error = String(error?.message || error).split("\n")[0];
  await shot("failure").catch(() => {});
  console.error(`journey failed: ${summary.error}`);
} finally {
  await context.close();
  await browser.close();
  const [video] = readdirSync(VIDEO_TMP);
  if (video)
    renameSync(path.join(VIDEO_TMP, video), path.join(OUT, "video.webm"));
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  summary.finishedAt = new Date().toISOString();
  writeFileSync(
    path.join(OUT, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`evidence ${OUT}`);
  process.exit(summary.ok ? 0 : 1);
}
