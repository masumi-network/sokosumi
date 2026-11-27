import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  EvalOutboundCallError,
  installEvalOutboundGuard,
  outboundAllowed,
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

  it("refuses and logs a lane's real external call before it leaves", async () => {
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
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).host)).toEqual([
      "api.exa.ai",
      "rest.ably.io",
    ]);
  });
});
