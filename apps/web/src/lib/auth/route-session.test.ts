import { describe, expect, it } from "vitest";

import {
  coreSessionUnavailableJson,
  coreSessionUnavailableText,
  type RouteSessionUnavailable,
} from "./route-session";

function unavailable(
  overrides?: Partial<RouteSessionUnavailable>,
): RouteSessionUnavailable {
  return { status: "unavailable", reason: "timeout", ...overrides };
}

describe("coreSessionUnavailableJson", () => {
  it("asks for a retry when Core never answered", async () => {
    const response = coreSessionUnavailableJson(
      "Rooms unavailable",
      unavailable(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "Rooms unavailable",
      reason: "timeout",
    });
  });

  it.each([403, 404])(
    "answers 502 for a Core %i, which no retry clears",
    async (httpStatus) => {
      // A trusted-origin check, a WAF rule on the web-to-Core hop, or a route
      // that is gone. Telling the browser to come back in a second would have
      // it hammer a misconfiguration until someone notices.
      const response = coreSessionUnavailableJson(
        "Rooms unavailable",
        unavailable({ reason: "http", httpStatus }),
      );

      expect(response.status).toBe(502);
      expect(response.headers.get("Retry-After")).toBeNull();
    },
  );

  it("still asks for a retry on a Core 500", async () => {
    const response = coreSessionUnavailableJson(
      "Rooms unavailable",
      unavailable({ reason: "http", httpStatus: 500 }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
  });
});

describe("coreSessionUnavailableText", () => {
  it("asks for a retry when Core never answered", async () => {
    const response = coreSessionUnavailableText(unavailable());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.text()).toBe("Service Unavailable: timeout");
  });

  it("answers 502 for a Core 403, which no retry clears", async () => {
    const response = coreSessionUnavailableText(
      unavailable({ reason: "http", httpStatus: 403 }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await response.text()).toBe("Bad Gateway: http");
  });
});
