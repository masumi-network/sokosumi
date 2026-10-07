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

function resolveIntegrations(
  extraDefaults: Array<{ name: string }> = [],
): Array<{ name: string }> {
  initSentry();
  const options = initMock.mock.calls[0]?.[0];
  const integrations = options.integrations;
  if (typeof integrations !== "function") {
    throw new Error("expected initSentry to pass an integrations callback");
  }
  return integrations([
    { name: "Http" },
    { name: "RequestData" },
    { name: "Hono" },
    { name: "Dedupe" },
    ...extraDefaults,
  ]);
}

describe("initSentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Traces and profiles are sampled at 0.005, so an unset error rate reads as
   * sampled to anyone scanning the three together. It is not, and a defect
   * that reports once per damaged row has nothing to spare.
   */
  it("sends every error, whatever the traces and profiles are sampled at", () => {
    initSentry();

    const options = initMock.mock.calls[0]?.[0];
    expect(options.sampleRate).toBe(1);
    expect(options.profileSessionSampleRate).toBe(0.005);
    expect(options.profileLifecycle).toBe("trace");
    expect(options.sendDefaultPii).toBeUndefined();
    expect(options.profilesSampleRate).toBeUndefined();
    expect(options.enhanceFetchErrorMessages).toBe("report-only");
    expect(options.dataCollection).toEqual({
      userInfo: true,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("stops the RequestData integration attaching the raw url, headers and cookies", () => {
    // The defaults attach `event.request.url`. Paths carry capability tokens
    // and the headers carry Authorization, so all of it has to be turned off.
    // The integrations callback only builds Http/RequestData when Sentry
    // (or this test) invokes it.
    const names = resolveIntegrations().map((integration) => integration.name);

    expect(requestDataIntegrationMock).toHaveBeenCalledWith({
      include: {
        url: false,
        query_string: false,
        headers: false,
        cookies: false,
      },
    });
    expect(names).toContain("RequestData");
    expect(names).not.toContain("Hono");
    expect(names).not.toContain("Dedupe");
  });

  it("drops the auto server span, whose name and url attributes are the raw path", () => {
    // The span is built from the node request before any middleware runs, so
    // no scope write can redact it, and beforeSend never sees a transaction
    // event. sentryMiddleware opens a replacement span named after the route
    // template. Outgoing spans and sessions are unaffected by this option.
    const names = resolveIntegrations().map((integration) => integration.name);

    expect(httpIntegrationMock).toHaveBeenCalledWith({
      disableIncomingRequestSpans: true,
    });
    expect(names).toContain("Http");
    expect(names).not.toContain("Hono");
    expect(names).not.toContain("Dedupe");
  });

  it("keeps sentryMiddleware as the incoming-span owner by dropping 11.2 Hono auto-instrumentation", () => {
    const names = resolveIntegrations([{ name: "Console" }]).map(
      (integration) => integration.name,
    );

    expect(names).toContain("Console");
    expect(names).toContain("Http");
    expect(names).toContain("RequestData");
    expect(names).toContain("ProfilingNode");
    expect(names).not.toContain("Hono");
    expect(names).not.toContain("Dedupe");
  });
});
