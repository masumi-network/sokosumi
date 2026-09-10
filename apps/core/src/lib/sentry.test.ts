import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  httpIntegrationMock,
  initMock,
  nodeProfilingIntegrationMock,
  requestDataIntegrationMock,
} = vi.hoisted(() => ({
  httpIntegrationMock: vi.fn(() => ({ name: "Http" })),
  initMock: vi.fn(),
  nodeProfilingIntegrationMock: vi.fn(() => ({ name: "ProfilingNode" })),
  requestDataIntegrationMock: vi.fn(() => ({ name: "RequestData" })),
}));

vi.mock("@sentry/node", () => ({
  httpIntegration: httpIntegrationMock,
  init: initMock,
  requestDataIntegration: requestDataIntegrationMock,
}));

vi.mock("@sentry/profiling-node", () => ({
  nodeProfilingIntegration: nodeProfilingIntegrationMock,
}));

vi.mock("../config/env.js", () => ({
  getEnv: () => ({
    SENTRY_DSN: "https://public@o0.ingest.sentry.io/123",
    SENTRY_ENVIRONMENT: "test",
  }),
}));

import { initSentry } from "./sentry";

describe("initSentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops the RequestData integration attaching the raw url, headers and cookies", () => {
    initSentry();

    // The defaults attach `event.request.url`, and `sendDefaultPii: true` adds
    // the request headers and cookies. Paths carry capability tokens and the
    // headers carry Authorization, so all of it has to be turned off.
    expect(requestDataIntegrationMock).toHaveBeenCalledWith({
      include: {
        url: false,
        query_string: false,
        headers: false,
        cookies: false,
      },
    });

    const options = initMock.mock.calls[0]?.[0];
    expect(options.integrations).toContainEqual({ name: "RequestData" });
  });

  it("drops the auto server span, whose name and url attributes are the raw path", () => {
    initSentry();

    // The span is built from the node request before any middleware runs, so
    // no scope write can redact it, and beforeSend never sees a transaction
    // event. sentryMiddleware opens a replacement span named after the route
    // template. Outgoing spans and sessions are unaffected by this option.
    expect(httpIntegrationMock).toHaveBeenCalledWith({
      disableIncomingRequestSpans: true,
    });

    const options = initMock.mock.calls[0]?.[0];
    expect(options.integrations).toContainEqual({ name: "Http" });
  });
});
