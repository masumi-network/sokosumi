import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isThirdPartyOnlyStack,
} from "@/lib/sentry/client-event-filters";

function linkedInInsightEvent(): Parameters<typeof beforeSendClientEvent>[0] {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch (px.ads.linkedin.com)",
          stacktrace: {
            frames: [
              {
                filename: "app:///li.lms-analytics/insight.old.min.js",
                function: "Gt",
              },
              {
                filename: "app:///frame_ant/frame_ant.js",
                function: "o",
              },
              {
                filename:
                  "node_modules/.pnpm/@sentry+core@10.54.0/node_modules/@sentry/core/src/instrument/fetch.ts",
                function: "o.headers",
              },
            ],
          },
        },
      ],
    },
  };
}

function serverActionFetchEvent(): Parameters<typeof beforeSendClientEvent>[0] {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch",
          stacktrace: {
            frames: [
              {
                filename:
                  "node_modules/.pnpm/next@16.2.6/node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
                function: "fetchServerAction",
              },
            ],
          },
        },
      ],
    },
  };
}

describe("beforeSendClientEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    expect(beforeSendClientEvent(linkedInInsightEvent(), {})).toBeNull();
  });

  it("drops Plausible fetch failures by domain", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
          },
        ],
      },
    };

    expect(beforeSendClientEvent(event, {})).toBeNull();
  });

  it("keeps server action fetch failures", () => {
    expect(beforeSendClientEvent(serverActionFetchEvent(), {})).toEqual(
      serverActionFetchEvent(),
    );
  });
});

describe("isThirdPartyOnlyStack", () => {
  it("returns true for LinkedIn insight stacks", () => {
    expect(isThirdPartyOnlyStack(linkedInInsightEvent())).toBe(true);
  });

  it("returns false for Next.js server action stacks", () => {
    expect(isThirdPartyOnlyStack(serverActionFetchEvent())).toBe(false);
  });
});
