import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { LOCAL_BLOB_HOST, readLocalBlob } from "./local-blob";

/**
 * Local eval runs talk to the plan, real Jev and the local machine, and to
 * nothing else: every other outbound request is a benchmark lane reaching a
 * real service (a send, a paid read, a provider's account). `record` logs
 * each such request; `enforce` also refuses it before it leaves the process.
 * Never on Vercel.
 */
export type OutboundGuardMode = "record" | "enforce";

/** Hosts a local eval run may reach: the ChatGPT plan, the Gateway (whose
 * own guard lets only real Jev through on plan runs) and this machine. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "api.openai.com",
  "auth.openai.com",
  "ai-gateway.vercel.sh",
  "localhost",
  "127.0.0.1",
  "::1",
]);

export class EvalOutboundCallError extends Error {
  constructor(host: string) {
    super(
      `A benchmark lane tried to reach ${host}; nothing was sent. Mock it in the eval world.`,
    );
    this.name = "EvalOutboundCallError";
  }
}

let installed: OutboundGuardMode | null = null;
const attempts: { host: string; via: string }[] = [];

/** Every request the guard refused (enforce) or would have (record). */
export function outboundAttempts(): readonly { host: string; via: string }[] {
  return attempts;
}

/**
 * No real storage either: eval lanes keep files in the on-disk Blob
 * stand-in (EVAL_LOCAL_BLOB_DIR, `local-blob.ts`), so every Vercel Blob host
 * is refused like any other third party (coordinator, 2026-11-27).
 */
export function outboundAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host.replace(/^\[|\]$/g, ""));
}

function note(logFile: string | undefined, host: string, via: string): void {
  attempts.push({ host, via });
  if (!logFile) return;
  appendFileSync(
    logFile,
    `${JSON.stringify({ at: new Date().toISOString(), host, via })}\n`,
  );
}

/** Installs the guard once for this process; returns the mode in force. */
export function installEvalOutboundGuard(
  mode: OutboundGuardMode,
  logFile?: string,
): OutboundGuardMode {
  if (process.env.VERCEL)
    throw new Error("The eval outbound guard is local only");
  if (installed) return installed;
  installed = mode;

  const send = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    // A file URL of the on-disk Blob stand-in (a fetch of an upload's
    // fileUrl) is answered from disk, never from the network.
    if (url.hostname === LOCAL_BLOB_HOST)
      return readLocalBlob(url.href).then((found) =>
        found
          ? new Response(new Uint8Array(found.bytes), {
              headers: { "content-type": found.contentType },
            })
          : new Response("Not found", { status: 404 }),
      );
    if (!outboundAllowed(url.hostname)) {
      note(logFile, url.hostname, "fetch");
      if (mode === "enforce")
        return Promise.reject(new EvalOutboundCallError(url.hostname));
    }
    return send(input, init);
  };

  for (const [name, module] of [
    ["http", http],
    ["https", https],
  ] as const) {
    type Send = (...args: unknown[]) => http.ClientRequest;
    const request = module.request as unknown as Send;
    const wrapped: Send = (...args) => {
      const first = args[0] as
        | string
        | URL
        | { hostname?: string | null; host?: string | null }
        | undefined;
      const host =
        typeof first === "string" || first instanceof URL
          ? new URL(first).hostname
          : (first?.hostname ?? first?.host ?? "localhost");
      const bare = String(host).split(":")[0] ?? "";
      if (!outboundAllowed(bare)) {
        note(logFile, bare, name);
        if (mode === "enforce") throw new EvalOutboundCallError(bare);
      }
      return request(...args);
    };
    module.request = wrapped as unknown as typeof module.request;
    module.get = ((...args: unknown[]) => {
      const req = wrapped(...args);
      req.end();
      return req;
    }) as unknown as typeof module.get;
  }
  return mode;
}
