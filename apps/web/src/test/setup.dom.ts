import "@testing-library/jest-dom/vitest";

import { act, cleanup, render } from "@testing-library/react";
import { cleanStores } from "nanostores";
import {
  createElement,
  type TransitionStartFunction,
  useContext,
  useTransition,
} from "react";
import { afterAll, afterEach, vi } from "vitest";

// happy-dom project only. Loading jest-dom and Testing Library (and through it
// react-dom) costs every test file that imports this, so the node project
// skips it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// happy-dom 20.12+ implements WAAPI. `Animation.cancel()` rejects `finished`
// with AbortError (spec). motion 13 calls cancel on unmount and does not catch
// that promise, so vitest reports unhandled rejections.
// The window outlives the file (`isolate: false`), so patch it only once.
const animationPrototype = globalThis.Animation?.prototype;
const PATCHED = Symbol.for("sokosumi.test.animationCancelPatched");
if (animationPrototype && !(PATCHED in animationPrototype)) {
  const originalCancel = animationPrototype.cancel;
  Object.defineProperty(animationPrototype, PATCHED, { value: true });
  animationPrototype.cancel = function cancel(this: Animation) {
    const finished = this.finished;
    originalCancel.call(this);
    void finished.catch((reason: unknown) => {
      if (
        reason instanceof Error &&
        reason.name === "AbortError" &&
        reason.message === "The animation was canceled."
      ) {
        return;
      }
      throw reason;
    });
  };
}

// happy-dom 21.0.4 batches internal 0ms timers (`if (!delay)`) onto a single
// backing timer stored on the live GlobalWindow (`window.frames`), and only
// clears `#zeroDelayTimeout.timeouts = null` when that timer fires
// (capricorn86/happy-dom#2532). When `window.happyDOM.abort()` cancels a
// pending 0ms timer between files under `isolate: false`, the batch stays
// non-null forever and every later internal 0ms timer (`FileReader` /
// `navigator.clipboard.readText()`, smooth `scrollTo`, `postMessage`) hangs
// for the rest of the worker. Coercing falsy delays to 1ms (Node's timer floor
// anyway) routes internal timers through happy-dom's normal per-timer path,
// which `abort()` and `clearTimeout()` clean up cleanly.
const ZERO_DELAY_TIMEOUT_PATCHED = Symbol.for(
  "sokosumi.test.zeroDelayTimeoutPatched",
);
const happyDomWindow = window.frames;
if (
  happyDomWindow &&
  happyDomWindow !== window &&
  !(ZERO_DELAY_TIMEOUT_PATCHED in happyDomWindow)
) {
  const originalSetTimeout = happyDomWindow.setTimeout;
  Object.defineProperty(happyDomWindow, ZERO_DELAY_TIMEOUT_PATCHED, {
    value: true,
  });
  happyDomWindow.setTimeout = ((
    callback: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) =>
    originalSetTimeout(
      callback,
      !delay ? 1 : delay,
      ...args,
    )) as typeof window.setTimeout;
}

// The window outlives the file (`isolate: false`). Give each file its own
// storage: a `vi.spyOn(localStorage, …)` never comes off happy-dom's Storage,
// even after `mockRestore`, so a shared one would carry the mock into later
// files. `setup.ts` puts the window's own storage back after the file.
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, name, {
    configurable: true,
    value: new Storage(),
  });
}

// Tests define their own `document.cookie`, `visibilityState` or `execCommand`
// on the shared document; put its own properties back after the file. React's
// `_react…` markers stay: react-dom outlives the file and sets them only once.
const documentBefore = Object.getOwnPropertyDescriptors(document);

// Tests also patch DOM prototypes (`Element.prototype.scrollIntoView = vi.fn()`).
// JavaScript's own builtins stay out: polyfills in dependencies that outlive
// the file patch those once and must keep their patch.
const domPrototypes = Object.getOwnPropertyNames(globalThis).flatMap((name) => {
  const value = (globalThis as Record<string, unknown>)[name];
  if (typeof value !== "function" || !value.prototype) return [];
  const isDom =
    extendsEventTarget(value.prototype) ||
    [
      "Range",
      "Selection",
      "DOMRect",
      "DOMRectReadOnly",
      "CSSStyleDeclaration",
    ].includes(name);
  return isDom ? [value.prototype as object] : [];
});

const prototypesBefore = domPrototypes.map(
  (prototype) =>
    [prototype, Object.getOwnPropertyDescriptors(prototype)] as const,
);

// By name: happy-dom's classes extend its own `EventTarget`, not the global one.
function extendsEventTarget(prototype: object | null): boolean {
  for (let p = prototype; p; p = Object.getPrototypeOf(p)) {
    if (p.constructor?.name === "EventTarget") return true;
  }
  return false;
}

function restoreOwnProperties(
  target: object,
  before: Record<PropertyKey, PropertyDescriptor>,
) {
  for (const key of Reflect.ownKeys(target)) {
    if (typeof key === "string" && key.startsWith("_react")) continue;
    const was = before[key];
    const now = Object.getOwnPropertyDescriptor(target, key);
    if (!now?.configurable) continue;
    if (!was) {
      Reflect.deleteProperty(target, key);
    } else if (
      now.value !== was.value ||
      now.get !== was.get ||
      now.set !== was.set
    ) {
      Object.defineProperty(target, key, was);
    }
  }
  for (const key of Reflect.ownKeys(before)) {
    if (!Object.hasOwn(target, key)) {
      Object.defineProperty(target, key, before[key]);
    }
  }
}

function restoreDocument() {
  restoreOwnProperties(document, documentBefore);
  for (const [prototype, before] of prototypesBefore) {
    restoreOwnProperties(prototype, before);
  }
}

// Unmounting the last `useSession` subscriber makes nanostores stop the Better
// Auth session atom on a 1s timer, and that stop calls `window.
// removeEventListener`. A file that unmounts it near its end lets the timer
// fire after happy-dom is torn down: "window is not defined" as an unhandled
// error, exit code 1 on an otherwise green run. Pass the real client through
// and stop its session atom ourselves while `window` still exists. Files that
// mock the client never load the real one, so there is nothing to stop.
let authClientModule: typeof import("@/lib/auth/auth.client") | undefined;
vi.mock("@/lib/auth/auth.client", async (importOriginal) => {
  authClientModule = await importOriginal();
  return authClientModule;
});

// Product callers always render under `LiveChatRoomsProvider` in the app frame.
// Existing unit tests render hooks or leaf callers directly without the frame,
// so keep the standalone-owner fallback in the DOM test harness rather than a
// conditional hook call in product code.
vi.mock("@/components/chat/use-live-chat-rooms", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/use-live-chat-rooms")
    >();
  function useLiveChatRoomsRead() {
    const provided = useContext(actual.LiveChatRoomsContext);
    if (provided !== null) {
      return provided;
    }
    return actual.useLiveChatRoomsOwner();
  }
  return {
    ...actual,
    useLiveChatRoomsRead,
    useLiveChatRooms: () => useLiveChatRoomsRead().rooms,
  };
});

afterEach(() => {
  cleanup();
  cleanStores(authClientModule?.authClient.$store.atoms.session);
});

// Files share one react-dom per worker (`isolate: false`). react-dom entangles
// every async transition with any still pending, so one left awaiting a promise
// that never settles keeps every later file's transitions pending too. Start a
// no-op transition after the file: if it cannot finish, this file leaked one.
afterAll(async () => {
  let isPending = true;
  let start: TransitionStartFunction = () => {};
  function Probe() {
    [isPending, start] = useTransition();
    return null;
  }
  try {
    const view = render(createElement(Probe));
    await act(async () => start(async () => {}));
    view.unmount();
  } finally {
    restoreDocument();
    await resetBrowserState();
  }
  if (isPending) {
    throw new Error(
      "This file, or one that ran before it in this worker, left a React async transition pending. Settle every promise a transition awaits before the test ends. Run the file alone to tell which.",
    );
  }
});

// Hand the next file the browser a file that runs first sees.
async function resetBrowserState() {
  // A fetch still in flight would otherwise fail in whichever file runs next.
  // Isolated runs got this from happy-dom's teardown.
  await window.happyDOM.abort();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
  document.head.replaceChildren();
  document.body.replaceChildren();
  for (const element of [document.documentElement, document.body]) {
    for (const { name } of [...element.attributes]) {
      element.removeAttribute(name);
    }
  }
  // happy-dom's defaults, as a file that runs first sees them.
  window.happyDOM.setURL("http://localhost:3000/");
  window.happyDOM.setViewport({
    width: 1024,
    height: 768,
    devicePixelRatio: 1,
  });
}
