import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  isFirstPartyHost,
  isThirdPartyFetchNoise,
  sentryBeforeSend,
} from "@/lib/sentry/third-party-fetch-errors";

function makeEvent(message: string, filenames: string[] = []): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

function makeHint(error: unknown): EventHint {
  return { originalException: error };
}

describe("isFirstPartyHost", () => {
  it("treats sokosumi domains as first-party", () => {
    expect(isFirstPartyHost("app.sokosumi.com")).toBe(true);
    expect(isFirstPartyHost("api.sokosumi.com")).toBe(true);
  });

  it("treats vercel preview hosts as first-party", () => {
    expect(isFirstPartyHost("sokosumi-web-git-main.vercel.app")).toBe(true);
  });

  it("treats analytics hosts as third-party", () => {
    expect(isFirstPartyHost("px.ads.linkedin.com")).toBe(false);
    expect(isFirstPartyHost("plausible.io")).toBe(false);
  });
});

describe("isThirdPartyFetchNoise", () => {
  it("drops linkedin insight tag fetch failures", () => {
    const error = new TypeError("Failed to fetch (px.ads.linkedin.com)");
    const event = makeEvent(error.message, [
      "app:///li.lms-analytics/insight.old.min.js",
    ]);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(true);
    expect(sentryBeforeSend(event, makeHint(error))).toBeNull();
  });

  it("drops plausible analytics fetch failures", () => {
    const error = new TypeError("Failed to fetch (plausible.io)");
    const event = makeEvent(error.message);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(true);
  });

  it("drops usercentrics dynamic import failures", () => {
    const message =
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined";
    const event = makeEvent(message);

    expect(
      isThirdPartyFetchNoise(event, makeHint(new TypeError(message))),
    ).toBe(true);
  });

  it("keeps first-party app fetch failures", () => {
    const error = new TypeError("Failed to fetch (app.sokosumi.com)");
    const event = makeEvent(error.message);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(false);
    expect(sentryBeforeSend(event, makeHint(error))).toBe(event);
  });

  it("keeps api fetch failures", () => {
    const error = new TypeError("Failed to fetch (api.sokosumi.com)");
    const event = makeEvent(error.message);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(false);
  });

  it("keeps bare failed fetch from server actions", () => {
    const error = new TypeError("Failed to fetch");
    const event = makeEvent(error.message, [
      "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
    ]);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(false);
  });

  it("ignores unrelated errors", () => {
    const error = new Error("Something else broke");
    const event = makeEvent(error.message);

    expect(isThirdPartyFetchNoise(event, makeHint(error))).toBe(false);
  });
});
