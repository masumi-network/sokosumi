import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

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
 * One storage exception, and only when it is configured: the eval-only
 * Vercel Blob store named by EVAL_BLOB_STORE_ID. Its objects live on
 * `<id>.<access>.blob.vercel-storage.com`; its API (vercel.com/api/blob)
 * is let through only with that store's token. Any other store is refused.
 */
function evalBlobStoreId(): string | null {
  return process.env.EVAL_BLOB_STORE_ID?.toLowerCase() || null;
}

function storeOfToken(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  // vercel_blob_rw_<storeId>_<secret>
  return token.split("_")[3]?.toLowerCase() || null;
}

export function outboundAllowed(
  host: string,
  request?: { path: string; authorization: string | null },
): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (ALLOWED_HOSTS.has(bare)) return true;
  const store = evalBlobStoreId();
  if (!store) return false;
  if (bare.startsWith(`${store}.`) && bare.endsWith(".blob.vercel-storage.com"))
    return true;
  return (
    bare === "vercel.com" &&
    Boolean(request?.path.startsWith("/api/blob")) &&
    storeOfToken(request?.authorization ?? null) === store
  );
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
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (
      !outboundAllowed(url.hostname, {
        path: url.pathname,
        authorization: headers.get("authorization"),
      })
    ) {
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
