import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import type { HTTPRequest, Page } from "puppeteer-core";

import {
  installPdfExportRequestGuard,
  isAllowedLocalBrowserUrl,
  MAX_PDF_RESOURCE_BYTES,
  redactUrlForLog,
} from "@/lib/utils/pdf-export-ssrf";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pdf-export-ssrf helpers", () => {
  it("allows local browser schemes without network fetches", () => {
    expect(isAllowedLocalBrowserUrl("data:image/png;base64,abc")).toBe(true);
    expect(isAllowedLocalBrowserUrl("about:blank")).toBe(true);
    expect(isAllowedLocalBrowserUrl("blob:https://example/uuid")).toBe(true);
    expect(isAllowedLocalBrowserUrl("https://example.com")).toBe(false);
  });

  it("redacts query strings from logged URLs", () => {
    expect(redactUrlForLog("https://cdn.example/a.png?token=secret#frag")).toBe(
      "https://cdn.example/a.png",
    );
  });

  it("continues local schemes and fulfills http(s) via ssrfSafeFetch", async () => {
    const handlers: Array<(request: HTTPRequest) => void> = [];
    const page = {
      on: (_event: string, handler: (request: HTTPRequest) => void) => {
        handlers.push(handler);
      },
    } as unknown as Page;

    installPdfExportRequestGuard(page);
    const handler = handlers[0];
    expect(handler).toBeTypeOf("function");

    const continueMock = vi.fn().mockResolvedValue(undefined);
    const localRequest = {
      url: () => "data:image/png;base64,abc",
      method: () => "GET",
      continue: continueMock,
      respond: vi.fn(),
      abort: vi.fn(),
    } as unknown as HTTPRequest;

    handler!(localRequest);
    await vi.waitFor(() => expect(continueMock).toHaveBeenCalled());
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();

    ssrfSafeFetchMock.mockResolvedValue(
      new Response(Buffer.from("png"), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    );
    const respondMock = vi.fn().mockResolvedValue(undefined);
    const remoteRequest = {
      url: () => "https://cdn.example/a.png",
      method: () => "GET",
      continue: vi.fn(),
      respond: respondMock,
      abort: vi.fn(),
    } as unknown as HTTPRequest;

    handler!(remoteRequest);
    await vi.waitFor(() => expect(respondMock).toHaveBeenCalled());
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://cdn.example/a.png",
      {
        method: "GET",
        maxResponseBytes: MAX_PDF_RESOURCE_BYTES,
      },
    );
    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 200,
        contentType: "image/png",
        body: expect.any(Buffer),
      }),
    );
  });

  it("aborts and logs when ssrfSafeFetch rejects (blocked target)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handlers: Array<(request: HTTPRequest) => void> = [];
    const page = {
      on: (_event: string, handler: (request: HTTPRequest) => void) => {
        handlers.push(handler);
      },
    } as unknown as Page;

    installPdfExportRequestGuard(page);
    ssrfSafeFetchMock.mockRejectedValue(new Error("connection refused"));

    const abortMock = vi.fn().mockResolvedValue(undefined);
    const request = {
      url: () => "http://169.254.169.254/latest/meta-data/?x=1",
      method: () => "GET",
      continue: vi.fn(),
      respond: vi.fn(),
      abort: abortMock,
    } as unknown as HTTPRequest;

    handlers[0]!(request);
    await vi.waitFor(() =>
      expect(abortMock).toHaveBeenCalledWith("blockedbyclient"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[pdf-export-ssrf] blocked request",
      expect.objectContaining({
        reason: "ssrf_or_fetch_failed",
        url: "http://169.254.169.254/latest/meta-data/",
      }),
    );
    warnSpy.mockRestore();
  });
});
