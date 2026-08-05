import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

/**
 * Redirect handling against a REAL HTTP server.
 *
 * The sibling coworker-retry tests stub `globalThis.fetch`, so they prove the
 * loop's logic but nothing about the runtime: `redirect: "manual"` is
 * defined by WHATWG to yield an opaque response (status 0, no headers), and
 * on that behaviour the loop below would silently treat a redirect as a final
 * response. Node/undici instead returns the real 3xx with `Location` readable,
 * which is what the implementation relies on.
 *
 * These tests pin that runtime contract, so a Node or undici change that moved
 * to opaque responses fails here instead of silently breaking redirects in
 * production.
 */

const SSE_BODY =
  'data: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
  "data: [DONE]\n\n";

let server: Server | undefined;

async function listen(
  handler: (url: string, port: number) => Parameters<typeof createServer>[0],
): Promise<number> {
  const port = await new Promise<number>((resolve) => {
    server = createServer((req, res) => {
      const address = server?.address() as AddressInfo;
      handler("", address.port)?.(req, res);
    });
    server.listen(0, "127.0.0.1", () =>
      resolve((server?.address() as AddressInfo).port),
    );
  });
  return port;
}

afterEach(() => {
  server?.close();
  server = undefined;
});

function streamOptions(baseUrl: string, assertUrlAllowed: () => void) {
  return {
    prompt: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Hi" }],
      },
    ],
    providerOptions: {
      sokosumi: {
        mode: "coworker",
        assertUrlAllowed,
        coworkerBaseUrl: baseUrl,
        coworkerSlug: "agent",
        sokosumiUserId: "user-1",
        previousResponseId: "resp_1",
      },
    },
  };
}

describe("coworker Responses redirects (real server)", () => {
  it("sees an inspectable 308 in manual mode and follows it same-origin", async () => {
    const seen: string[] = [];
    const port = await listen(() => (req, res) => {
      seen.push(req.url ?? "");
      if (req.url === "/api/responses") {
        res.writeHead(308, {
          location: `http://127.0.0.1:${(server?.address() as AddressInfo).port}/api/v2/responses`,
        });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(SSE_BODY);
    });

    const assertUrlAllowed = vi.fn();
    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream(
      streamOptions(`http://127.0.0.1:${port}/api`, assertUrlAllowed),
    );

    // Both hops actually reached the server: the 308 was readable, not opaque.
    expect(seen).toEqual(["/api/responses", "/api/v2/responses"]);
    expect(assertUrlAllowed).toHaveBeenCalledTimes(2);
  });

  it("refuses a cross-origin redirect before the second request leaves", async () => {
    const seen: string[] = [];
    const port = await listen(() => (req, res) => {
      seen.push(req.url ?? "");
      // "localhost" and "127.0.0.1" are different origins by URL comparison.
      res.writeHead(307, { location: "http://attacker.invalid/responses" });
      res.end();
    });

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await expect(
      model.doStream(streamOptions(`http://127.0.0.1:${port}/api`, vi.fn())),
    ).rejects.toThrowError(/different origin/);

    // Only the first request was made; identity headers never left the origin.
    expect(seen).toEqual(["/api/responses"]);
  });
});
