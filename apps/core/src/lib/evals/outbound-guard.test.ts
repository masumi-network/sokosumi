import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_BLOB_HOST, put } from "./local-blob";
import {
  EvalOutboundCallError,
  installEvalOutboundGuard,
  outboundAllowed,
  outboundAttempts,
} from "./outbound-guard";

describe("the eval outbound guard", () => {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      sent.push(String(input));
      return new Response("ok");
    }),
  );
  let dir = "";
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("allows the plan, the Gateway and this machine, and nothing else", () => {
    for (const host of ["api.openai.com", "ai-gateway.vercel.sh", "localhost"])
      expect(outboundAllowed(host), host).toBe(true);
    for (const host of ["api.exa.ai", "backend.composio.dev", "rest.ably.io"])
      expect(outboundAllowed(host), host).toBe(false);
  });

  it("refuses every real Vercel Blob store: lanes keep files on disk", () => {
    for (const host of [
      "vercel.com",
      "blob.vercel-storage.com",
      "abcd.public.blob.vercel-storage.com",
      "abcd.private.blob.vercel-storage.com",
    ])
      expect(outboundAllowed(host), host).toBe(false);
  });

  it("refuses, counts and logs a lane's real external call before it leaves", async () => {
    dir = await mkdtemp(join(tmpdir(), "outbound-"));
    const log = join(dir, "outbound.jsonl");
    installEvalOutboundGuard("enforce", log);
    await expect(fetch("https://api.exa.ai/search")).rejects.toBeInstanceOf(
      EvalOutboundCallError,
    );
    expect(() => https.request("https://rest.ably.io/channels")).toThrow(
      EvalOutboundCallError,
    );
    await fetch("http://localhost:3001/health");
    expect(sent).toEqual(["http://localhost:3001/health"]);
    // Counted in process even when the caller swallows the error.
    expect(outboundAttempts().map((attempt) => attempt.host)).toEqual([
      "api.exa.ai",
      "rest.ably.io",
    ]);
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).host)).toEqual([
      "api.exa.ai",
      "rest.ably.io",
    ]);
  });

  // After the test above installed the guard (it installs once per process).
  it("answers the on-disk Blob stand-in's URLs from disk, never the network", async () => {
    const store = await mkdtemp(join(tmpdir(), "guard-blob-"));
    vi.stubEnv("EVAL_LOCAL_BLOB_DIR", store);
    const before = sent.length;
    try {
      const stored = await put("drive/seed.md", "seeded", {
        contentType: "text/markdown",
      });
      expect(await (await fetch(stored.url)).text()).toBe("seeded");
      expect(
        (await fetch(`https://${LOCAL_BLOB_HOST}/drive/missing`)).status,
      ).toBe(404);
      expect(sent.length).toBe(before);
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  });
});
