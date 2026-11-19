// Bombadil spec for Sokosumi: random clicks, typing, scrolling and navigation,
// checked against the default properties. Run it with `bin/explore.mjs`.
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";

export {
  clicks,
  inputs,
  navigation,
  scroll,
  waitOnce,
} from "@antithesishq/bombadil/browser/defaults/actions";
export { noHttpErrorCodes } from "@antithesishq/bombadil/browser/defaults/properties";

// The local stack logs these on every page: Next.js dev-mode warnings, Turbopack's
// lazy compilation cut short by a reload, and Ably failing on the placeholder keys.
// They are not bugs a user meets.
const DEV_NOISE = [
  "Cannot render a sync or defer <script> outside the main document",
  "In HTML, %s cannot be a child of <%s>",
  "<%s> cannot contain a nested %s",
  "A tree hydrated but some attributes of the server rendered HTML didn't match",
  "Lazily compiled dynamic import of",
  "Ably auth request failed",
];
const isNoise = (text: string) =>
  DEV_NOISE.some((noise) => text.includes(noise));

const consoleErrors = extract((state) =>
  state.console
    .filter((e) => e.level === "error")
    .map((e) => String(e.args[0] ?? ""))
    .filter((text) => !isNoise(text)),
);

const uncaught = extract((state) =>
  state.errors.uncaughtExceptions
    .map((e) => `${e.text} ${e.remote_object?.description ?? ""}`)
    .filter((text) => !isNoise(text)),
);

// The defaults of the same names, minus the noise above.
export const noConsoleErrors = always(() => consoleErrors.current.length === 0);
export const noUncaughtExceptions = always(() =>
  uncaught.current.every(
    (e) => !e.startsWith("Uncaught") || e.startsWith("Uncaught (in promise)"),
  ),
);
export const noUnhandledPromiseRejections = always(() =>
  uncaught.current.every((e) => !e.startsWith("Uncaught (in promise)")),
);
