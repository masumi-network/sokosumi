import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMarkdownFromOpenApiMock,
  getBetterAuthPublicBaseUrlMock,
  getEnvMock,
  getOpenAPI31DocumentMock,
  initSentryMock,
  serveMock,
  validateEnvMock,
} = vi.hoisted(() => ({
  createMarkdownFromOpenApiMock: vi.fn(),
  getBetterAuthPublicBaseUrlMock: vi.fn(),
  getEnvMock: vi.fn(),
  getOpenAPI31DocumentMock: vi.fn(),
  initSentryMock: vi.fn(),
  serveMock: vi.fn(),
  validateEnvMock: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

vi.mock("@scalar/hono-api-reference", () => ({
  Scalar: () => {
    return () => new Response("docs");
  },
}));

vi.mock("@scalar/openapi-to-markdown", () => ({
  createMarkdownFromOpenApi: createMarkdownFromOpenApiMock,
}));

vi.mock("@/config/env", () => ({
  getBetterAuthPublicBaseUrl: getBetterAuthPublicBaseUrlMock,
  getEnv: getEnvMock,
  validateEnv: validateEnvMock,
}));

vi.mock("@/lib/sentry", () => ({
  initSentry: initSentryMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      verifyApiKey: vi.fn(),
    },
  },
}));

vi.mock("@/routes/auth/index", () => {
  const app = new Hono();
  app.get("/open-api/generate-schema", (c) => {
    return c.json({ auth: true });
  });

  return { default: app };
});

vi.mock("@/routes/debug/index", () => {
  return { default: new Hono() };
});

vi.mock("@/routes/sync/index", () => {
  return { default: new Hono() };
});

vi.mock("@/routes/well-known/index", () => {
  const app = new Hono();
  app.get("/.well-known/oauth-authorization-server/auth", (c) =>
    c.json({ issuer: "http://localhost:8787/auth" }),
  );

  return { default: app };
});

vi.mock("@/routes/v1/index", () => {
  const app = new Hono();
  app.get("/openapi.json", (c) => {
    return c.json({ openapi: "3.1.0" });
  });
  Object.assign(app, {
    getOpenAPI31Document: getOpenAPI31DocumentMock,
  });

  return { default: app };
});

type FetchHandler = (request: Request) => Promise<Response>;

async function loadFetchHandler(): Promise<FetchHandler> {
  vi.resetModules();

  await import("./index");

  expect(serveMock).toHaveBeenCalledTimes(1);

  const options = serveMock.mock.calls[0]?.[0] as { fetch: FetchHandler };
  return options.fetch;
}

describe("core index", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getEnvMock.mockReturnValue({
      NODE_ENV: "development",
      PORT: 8787,
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue("http://localhost:8787");
    validateEnvMock.mockReturnValue({
      NODE_ENV: "development",
      PORT: 8787,
    });
    getOpenAPI31DocumentMock.mockReturnValue({
      openapi: "3.1.0",
      info: {
        title: "Sokosumi API",
        version: "1.0.0",
      },
    });
    serveMock.mockImplementation(() => undefined);
  });

  it("serves robots.txt that disallows all crawlers", async () => {
    const fetchHandler = await loadFetchHandler();

    const response = await fetchHandler(
      new Request("http://localhost/robots.txt"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await response.text()).toBe("User-Agent: *\nDisallow: /\n");
  });

  it("does not generate llms markdown during startup and still serves docs routes", async () => {
    createMarkdownFromOpenApiMock.mockResolvedValue("# llms");

    const fetchHandler = await loadFetchHandler();

    expect(validateEnvMock).toHaveBeenCalledTimes(1);
    expect(initSentryMock).toHaveBeenCalledTimes(1);
    expect(createMarkdownFromOpenApiMock).not.toHaveBeenCalled();

    const docsResponse = await fetchHandler(new Request("http://localhost/"));
    expect(docsResponse.status).toBe(200);
    expect(await docsResponse.text()).toBe("docs");

    const openApiResponse = await fetchHandler(
      new Request("http://localhost/v1/openapi.json"),
    );
    expect(openApiResponse.status).toBe(200);
    expect(await openApiResponse.json()).toEqual({ openapi: "3.1.0" });
  });

  it("generates llms markdown on first request and reuses it afterwards", async () => {
    createMarkdownFromOpenApiMock.mockResolvedValue("# llms");

    const fetchHandler = await loadFetchHandler();

    const firstResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe("# llms");
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(1);

    const secondResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toBe("# llms");
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(1);
  });

  it("reuses cached llms markdown even when it is an empty string", async () => {
    createMarkdownFromOpenApiMock.mockResolvedValue("");

    const fetchHandler = await loadFetchHandler();

    const firstResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe("");
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(1);

    const secondResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toBe("");
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when llms generation fails and retries on the next request", async () => {
    createMarkdownFromOpenApiMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("# llms");

    const fetchHandler = await loadFetchHandler();

    const failedResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(failedResponse.status).toBe(500);
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(1);

    const recoveredResponse = await fetchHandler(
      new Request("http://localhost/llms.txt"),
    );
    expect(recoveredResponse.status).toBe(200);
    expect(await recoveredResponse.text()).toBe("# llms");
    expect(createMarkdownFromOpenApiMock).toHaveBeenCalledTimes(2);
  });
});
