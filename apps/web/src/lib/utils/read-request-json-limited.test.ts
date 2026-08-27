import { describe, expect, it } from "vitest";

import { readRequestJsonWithByteLimit } from "@/lib/utils/read-request-json-limited";

function requestWithBody(
  body: string,
  headers?: Record<string, string>,
): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("readRequestJsonWithByteLimit", () => {
  it("parses JSON under the byte limit", async () => {
    const result = await readRequestJsonWithByteLimit<{ html: string }>(
      requestWithBody(JSON.stringify({ html: "hi" })),
      1_000,
    );
    expect(result).toEqual({ ok: true, value: { html: "hi" } });
  });

  it("rejects when Content-Length exceeds the limit before reading", async () => {
    const request = {
      headers: new Headers({ "content-length": "9999" }),
      body: {
        getReader: () => {
          throw new Error(
            "should not read body when Content-Length is over limit",
          );
        },
      },
    } as unknown as Request;

    const result = await readRequestJsonWithByteLimit(request, 10);
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects when streamed body exceeds the limit without Content-Length", async () => {
    const payload = JSON.stringify({ html: "x".repeat(200) });
    const result = await readRequestJsonWithByteLimit(
      requestWithBody(payload),
      50,
    );
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects invalid JSON", async () => {
    const result = await readRequestJsonWithByteLimit(
      requestWithBody("not-json"),
      1_000,
    );
    expect(result).toEqual({ ok: false, error: "invalid_json" });
  });
});
