import dns from "node:dns";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ssrfSafeStreamFetch } from "./ssrf-fetch.js";

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

describe("SSRF invariant: stream destinations cannot resolve to internal addresses", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ])("blocks %s at connection time", async (url) => {
    await expect(
      ssrfSafeStreamFetch(url, { maxResponseBytes: 1024 }),
    ).rejects.toThrow(/not allowed|private IP/);
  });

  it("blocks a valid DNS hostname resolving to loopback before its HTTP fixture receives any request", async () => {
    const received: string[] = [];
    const server = http.createServer((request, response) => {
      received.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("data: should never arrive\n\n");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      const lookup = vi.spyOn(dns, "lookup");
      lookup.mockImplementation((hostname, options, callback) => {
        if (hostname !== "private-coworker.example")
          throw new Error("Unexpected DNS lookup");
        queueMicrotask(() => {
          if (typeof options === "object" && options.all) {
            callback(null, [{ address: "127.0.0.1", family: 4 }]);
          } else {
            callback(null, "127.0.0.1", 4);
          }
        });
      });
      syncBuiltinESMExports();
      await expect(
        ssrfSafeStreamFetch(
          `http://private-coworker.example:${address.port}/responses`,
          { method: "POST", body: "{}", maxResponseBytes: 1024 },
        ),
      ).rejects.toThrow(/not allowed|private IP/);
      expect(lookup).toHaveBeenCalled();
      expect(received).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
