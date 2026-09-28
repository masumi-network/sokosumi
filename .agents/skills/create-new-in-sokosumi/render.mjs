#!/usr/bin/env node
// Renders a "New in Sokosumi" content fragment into a 2048x1152 PNG.
// Usage: node .agents/skills/create-new-in-sokosumi/render.mjs <content.html> <out.png>
// Exit 2 means the image rendered but something overflows (outlined in red).

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const [contentArg, outArg] = process.argv.slice(2);
if (!contentArg || !outArg) {
  console.error("Usage: node render.mjs <content.html> <out.png>");
  process.exit(1);
}
const outPath = resolve(outArg);

function cssBlock(css, selector) {
  const match = new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m").exec(
    css,
  );
  if (!match) throw new Error(`globals.css has no top-level ${selector} block`);
  let depth = 0;
  for (let i = match.index; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0)
      return css.slice(match.index + selector.length, i + 1);
  }
  throw new Error(`Unclosed ${selector} block in globals.css`);
}

const globals = readFileSync(
  join(repo, "apps/web/src/app/globals.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = `:root${cssBlock(globals, ":root")}\n:root${cssBlock(globals, ".dark")}`;

const lucideIcons = join(
  dirname(
    createRequire(join(repo, "apps/web/package.json")).resolve(
      "lucide-react/package.json",
    ),
  ),
  "dist/esm/icons",
);

async function lucideSvg(name) {
  const file = join(lucideIcons, `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`Unknown lucide icon "${name}"`);
  const { __iconData } = await import(pathToFileURL(file).href);
  if (!__iconData) {
    const alias = /from '\.\/([a-z0-9-]+)\.mjs'/.exec(
      readFileSync(file, "utf8"),
    );
    if (!alias) throw new Error(`Cannot read lucide icon "${name}"`);
    return lucideSvg(alias[1]);
  }
  const children = __iconData.node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");
      return `<${tag} ${attributes}/>`;
    })
    .join("");
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

let content = readFileSync(resolve(contentArg), "utf8");
const iconTag = /<i data-icon="([a-z0-9-]+)"><\/i>/g;
const names = [...new Set([...content.matchAll(iconTag)].map((m) => m[1]))];
const svgs = new Map(
  await Promise.all(names.map(async (name) => [name, await lucideSvg(name)])),
);
content = content.replace(iconTag, (_, name) => svgs.get(name));

const html = readFileSync(join(here, "template.html"), "utf8")
  .replace("/*{{TOKENS}}*/", () => tokens)
  .replace("<!--{{CONTENT}}-->", () => content);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const bin of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ]) {
    const which = spawnSync("which", [bin], { encoding: "utf8" });
    if (which.status === 0) candidates.push(which.stdout.trim());
  }
  const chrome = candidates.find((path) => path && existsSync(path));
  if (!chrome)
    throw new Error("Chrome not found. Set CHROME_PATH to a Chrome binary.");
  return chrome;
}

// Headless Chrome can linger after it finishes, so stop it once `done` matches.
// Its helper processes outlive the launcher, so the whole group is killed.
function runChrome(chrome, profile, args, done) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        `--user-data-dir=${profile}`,
        "--window-size=1024,576",
        "--virtual-time-budget=5000",
        ...args,
      ],
      { detached: true },
    );
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, 120_000);
    const onData = (chunk) => {
      output += chunk;
      if (done(output)) stop();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("Chrome timed out after 120s"));
      else resolvePromise(output);
    });
  });
}

const work = mkdtempSync(join(tmpdir(), "new-in-sokosumi-"));
try {
  const page = join(work, "page.html");
  writeFileSync(page, html);
  const url = pathToFileURL(page).href;
  const chrome = findChrome();

  const dom = await runChrome(
    chrome,
    join(work, "profile-dom"),
    ["--dump-dom", url],
    (out) => out.includes("</html>"),
  );
  const overflowing = Number(/<title>overflow:(\d+)<\/title>/.exec(dom)?.[1]);

  const log = await runChrome(
    chrome,
    join(work, "profile-shot"),
    ["--force-device-scale-factor=2", `--screenshot=${outPath}`, url],
    (out) => out.includes("bytes written to file"),
  );
  if (!log.includes("bytes written to file") || !existsSync(outPath)) {
    throw new Error(`Chrome wrote no screenshot:\n${log}`);
  }

  console.log(`Rendered ${outPath}`);
  if (Number.isNaN(overflowing)) {
    console.error("Layout check did not run; review the image by eye.");
  } else if (overflowing > 0) {
    console.error(
      `${overflowing} element(s) overflow and are outlined in red. Shorten the copy or the mock, then render again.`,
    );
    process.exitCode = 2;
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
