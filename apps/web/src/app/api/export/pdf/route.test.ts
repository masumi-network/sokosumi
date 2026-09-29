import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secrets: vi.fn(),
  executablePath: vi.fn(),
  session: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  launch: vi.fn(),
  guard: vi.fn(),
  page: {
    setJavaScriptEnabled: vi.fn(),
    setRequestInterception: vi.fn(),
    setContent: vi.fn(),
    evaluate: vi.fn(),
    emulateMediaType: vi.fn(),
    pdf: vi.fn(),
  },
  close: vi.fn(),
  newPage: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({ getSessionResult: mocks.session }));
vi.mock("@/lib/clients/core.client", () => ({
  createCoreGeneratedClient: () => ({}),
}));
vi.mock("@/lib/clients/generated/core", () => ({
  acquireExportLease: mocks.acquire,
  releaseExportLease: mocks.release,
}));
vi.mock("@/lib/utils/pdf-export-ssrf", () => ({
  installPdfExportRequestGuard: mocks.guard,
}));
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_SOKOSUMI_URL: "https://app.example",
  }),
}));
vi.mock("@/config/env.secrets", () => ({ getEnvSecrets: mocks.secrets }));
vi.mock("puppeteer", () => ({ launch: mocks.launch }));
vi.mock("puppeteer-core", () => ({ launch: mocks.launch }));
vi.mock("@sparticuz/chromium-min", () => ({
  default: { args: [], executablePath: mocks.executablePath },
}));

import { POST } from "./route";

function request(signal?: AbortSignal) {
  return POST(
    new Request("https://app.example/api/export/pdf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html: "<script>while(true){}</script><p>hello</p>",
      }),
      signal,
    }) as never,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.secrets.mockReturnValue({});
  mocks.session.mockResolvedValue(ok({ user: { id: "user-1" } }));
  mocks.acquire.mockResolvedValue({
    data: { data: { token: "token", durationMs: 100 } },
  });
  mocks.release.mockResolvedValue({ data: { data: { released: true } } });
  mocks.launch.mockResolvedValue({
    newPage: mocks.newPage,
    close: mocks.close,
  });
  mocks.newPage.mockResolvedValue(mocks.page);
  mocks.close.mockResolvedValue(undefined);
  for (const fn of Object.values(mocks.page)) fn.mockResolvedValue(undefined);
  mocks.page.pdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
afterEach(() => vi.useRealTimers());

describe("POST /api/export/pdf", () => {
  it("returns 401 when unauthenticated and never launches a browser", async () => {
    mocks.session.mockResolvedValue(ok(null));
    expect((await request()).status).toBe(401);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it("returns 503 when the session read cannot reach Core", async () => {
    mocks.session.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("disables page scripts before loading content and closes before releasing", async () => {
    mocks.release.mockImplementation(() => {
      expect(mocks.close).toHaveBeenCalledOnce();
      return { data: { data: { released: true } } };
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(mocks.page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(
      mocks.page.setJavaScriptEnabled.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.page.setContent.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.guard).toHaveBeenCalledWith(
      mocks.page,
      expect.any(AbortSignal),
    );
  });
  it.each(["setContent", "evaluate", "pdf"] as const)(
    "aborts a stalled %s at the total deadline",
    async (step) => {
      mocks.page[step].mockReturnValue(new Promise(() => {}));
      const pending = request();
      await vi.advanceTimersByTimeAsync(100);
      const response = await pending;
      expect(response.status).toBe(504);
      expect(mocks.launch.mock.calls[0]?.[0].signal.aborted).toBe(true);
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(mocks.release).toHaveBeenCalledOnce();
    },
  );
  it("uses one cumulative deadline instead of restarting it at each step", async () => {
    mocks.page.setContent.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 60)),
    );
    mocks.page.evaluate.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 60)),
    );
    const pending = request();
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe(504);
    expect(mocks.page.pdf).not.toHaveBeenCalled();
  });
  it("closes a browser whose launch settles after the deadline", async () => {
    let finishLaunch: ((value: unknown) => void) | undefined;
    mocks.launch.mockReturnValue(
      new Promise((resolve) => {
        finishLaunch = resolve;
      }),
    );
    const pending = request();
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe(504);
    finishLaunch?.({ close: mocks.close, newPage: mocks.newPage });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.newPage).not.toHaveBeenCalled();
  });
  it("bounds browser close and aborts its process signal", async () => {
    mocks.close.mockReturnValue(new Promise(() => {}));
    const pending = request();
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe(504);
    expect(mocks.launch.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });
  it("rejects excess exports before launching Chromium", async () => {
    mocks.acquire.mockResolvedValue({
      error: { message: "limited" },
      response: new Response(null, {
        status: 429,
        headers: { "Retry-After": "10" },
      }),
    });
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});

it("retains admission until canceled Chromium preparation settles", async () => {
  mocks.secrets.mockReturnValue({
    VERCEL_URL: "preview.example",
    CHROMIUM_EXECUTABLE_URL: "https://cdn.example/chromium.tar",
  });
  let finish: ((path: string) => void) | undefined;
  mocks.executablePath.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = request();
  await vi.advanceTimersByTimeAsync(100);
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
  finish?.("/tmp/chromium");
  expect((await pending).status).toBe(504);
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.launch).not.toHaveBeenCalled();
});
