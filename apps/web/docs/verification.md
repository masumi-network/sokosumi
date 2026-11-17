# Verifying Web UI

Read before claiming a Web layout, styling or navigation change works. Recipes run from a worktree with no login, cheapest first. Paths are relative to `apps/web/`.

`agent-browser` can run Chrome or Lightpanda (`"engine"` in `~/.agent-browser/config.json`; `navigator.userAgent` tells which). Lightpanda has no layout engine or CSS, so it cannot judge anything visual. Use Playwright with Chrome or WebKit for screenshots, measurements and frame checks.

## 1. Dump the real markup

Render the actual component with its real props in a throwaway `*.test.tsx` beside it, and write `container.innerHTML` to a file. Mock `next/navigation`, `next-intl` and `@/components/ui/tooltip` and no provider plumbing is needed. Reach for the dump instead of re-typing a component's wrapper classes into a preview: a reconstruction misses the prop or sibling that holds the bug.

- Wrap the render in `NextIntlClientProvider` with `formats={createFormats("h23")}` (`@/i18n/time-format`), or named formats such as `dateTimeMedium` print raw `Date.toString()` text.
- For a before/after pair, copy the old version with `git show HEAD:<path>` into a throwaway `zz-*.tsx` under a renamed export and render both in one dump. Delete every throwaway file and check `git status --short`.

## 2. Static mock from compiled CSS

Compile the app's own stylesheet and inline it beside the dumped markup in one HTML file; open it with Playwright. No `next dev`, `.env` or session.

```js
// The script must live inside apps/web: Node resolves these imports from the script's directory.
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const out = await postcss([tailwind()]).process(readFileSync(`${ROOT}/src/app/globals.css`, "utf8"), {
  from: `${ROOT}/src/app/globals.css`,
  to: OUT,
});
```

Tailwind v4 scans sources from the CSS file's location, so every class the components use is emitted. The mock tells the truth only with these:

- `class="dark"` on `<html>` for dark mode: the theme is class-based, so the browser's color scheme does not switch it.
- `<meta name="viewport" content="width=device-width, initial-scale=1">`, or a phone viewport lays out at 980px and no `sm:` breakpoint switches.
- A Radix dialog dumps as a `fixed` portal: give it its own page. A panel that is `absolute inset-0 lg:static` needs a `position: relative` frame with a real height.
- Rows with `[content-visibility:auto]` (Notification Center) paint blank below the fold until scrolled into view; grep the markup before suspecting the render.

Reading `getComputedStyle` on the same element in the mock and in a design mock is a quick computed-style diff when a shared primitive replaced bespoke markup.

## 3. Throwaway `/share` route on a dev server

Use only when the check needs real routing, hydration or portals. `/share/` is auth-exempt in `src/proxy.ts`.

- Page at `src/app/share/zz-<name>/page.tsx`. A `"use client"` page needs its own `NextIntlClientProvider` with the full `messages/en.json` and `createFormats()`, because the share layout's client bag (`SHARE_MESSAGE_PATHS`) does not carry `App.*`. Or serve a section-1 dump from a server component with `dangerouslySetInnerHTML`.
- Leave out `export const dynamic`: `cacheComponents` rejects it.
- Sidebar rows need `SidebarProvider` around them.
- Delete the page before committing.

## 4. WebKit layout

Phone layout verdicts need WebKit: Chromium computes some layout differently and reports it as fine. Chromium blockifies `display: -webkit-box` + `-webkit-line-clamp` (computed `display` is `flow-root`) where WebKit keeps the legacy box, and WebKit counts overflow past the end of a scroller's content in `scrollHeight` where Chromium does not. Plain widths and padding agree across engines.

- **Playwright WebKit at phone width (402px)** reproduces most iOS layout bugs. Write it as `src/**/*.webkit.test.ts` and run `pnpm --filter web test:webkit` (setup in `vitest.webkit.config.mts`). Use plain `playwright` from a node test; `@vitest/browser*` stays out of `apps/web` because its matcher types replace jest-dom's and break `toHaveTextContent(/re/)` typechecks.
- Write report files outside `apps/web`: a file written inside it triggers HMR and reloads the page under test.
- Scripted `scrollBy` steps reproduce iOS touch-scroll behaviour under an iPhone UA only after a `touchstart` is dispatched on the scroller; the transcript and TanStack Virtual hold corrections while a touch is active.
- **iOS Simulator Safari** confirms: `xcrun simctl boot <device>`, then `xcrun simctl openurl booted http://localhost:<port>/share/<name>`. Use `localhost`, not `127.0.0.1`: `allowedDevOrigins` admits only `localhost`. `xcrun simctl io booted screenshot <file>` captures it; run it in the background for a mid-gesture frame.
- **Home-screen (standalone) web app** geometry differs from Safari: probe it with a `/share` page that prints `innerHeight`, `main.clientHeight` and unit sizes, add it with Share → Add to Home Screen, and launch the clip. Turbopack HMR reaches it.
- A Sentry replay pins a device-only bug to the pixel: pull its rrweb segments with `sentry api "/projects/masumi/sokosumi/replays/<id>/recording-segments/?per_page=50"` and read row transforms, container height and scroll events against both edges of the viewport.

## Web push

A push test that shows no banner is usually a display problem, not a delivery failure. Open Notification Center first: an entry there means the push arrived, which rules out the whole network path. Then check:

- A macOS Focus mode, or the notification setting for screen mirroring and sharing: either can hold banners back.
- A reused `tag` replaces the old entry silently. Test with a unique `tag` and `renotify: true`.
- A `showNotification` call from the DevTools console runs while DevTools holds focus. Delay it with `setTimeout`, then click the page.
- A tab open for a while can return a dead registration from `getRegistration()`. Reload and use `await navigator.serviceWorker.ready`.

## Instant navigation

`next dev` locates a blocking route but cannot judge one: it does not prefetch and its navigation lock is unreliable. The verdict comes from a production build with an `instant()` test (`.agents/skills/next-cache-components-optimizer/`). Its insight log misleads in three ways:

- Each insight is reported once per dev server run. Restart the server before trusting a quiet second visit.
- Only the first blocker per route is reported. Fixing it reveals the next one.
- Server Component frames vanish when children pass through a client boundary (`AppMobileChrome` in the `(app)` shell), so the stack shows anonymous `div`s and names the wrong component. Use `next build --debug-prerender` for stacks; a real signed-in session also gives named frames where a fake cookie does not.
