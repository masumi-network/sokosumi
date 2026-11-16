import { describe, expect, it } from "vitest";

import apiV1 from "./index.js";
import { cmoLockedProjectId } from "./projects/cmo-project-lock.js";
import { cusoLockedBotId } from "./soko-bots/cuso-lock.js";

const WRITE_METHODS = ["put", "post", "patch", "delete"] as const;
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

type Operation = { responses?: Record<string, unknown> };

const coreDoc = apiV1.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Sokosumi API", version: "1.0.0" },
});

const writes = Object.entries(coreDoc.paths ?? {}).flatMap(
  ([path, item = {}]) =>
    WRITE_METHODS.flatMap((method) => {
      const operation = (item as Record<string, Operation | undefined>)[method];
      return operation ? [{ method, path, operation }] : [];
    }),
);

/** The OpenAPI path with every `{param}` filled, as the locks match it. */
function concrete(path: string): string {
  return path.replace(/\{[^}]+\}/g, SAMPLE_ID);
}

/** Routes that call `requireNotCmoProject`, `requireNotCuso` or `requireNotCmoDriveFile` themselves. */
const DIRECT_LOCKED = new Set([
  "PATCH /drive/resources/{id}/metadata",
  "DELETE /drive/folders/delete",
  "PATCH /drive/folders/rename",
  "PATCH /drive/files/move",
  "DELETE /drive/files/delete",
  "PATCH /drive/files/rename",
  "PUT /jobs/{id}/workspace",
  "POST /agents/{id}/jobs",
  "POST /image-studio-agent/sessions",
  "POST /image-studio-agent/sessions/{eveSessionId}/initial-turn",
  "PUT /image-studio-agent/assets/{assetId}/headline",
  "POST /soko-bots",
  "POST /soko-bots/{sokoBotId}",
  "POST /soko-bots/{id}/api-keys",
  "PATCH /soko-bots/{id}/api-keys/{keyId}",
  "DELETE /soko-bots/{id}/api-keys/{keyId}",
]);

const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

function missing(
  status: string,
  locked: (method: string, path: string) => boolean,
) {
  return writes
    .filter(({ method, path }) => locked(method, path))
    .filter(({ operation }) => !operation.responses?.[status])
    .map(({ method, path }) => key(method, path));
}

describe("CMO lock responses (ADR 0066)", () => {
  it("knows every directly locked route", () => {
    const served = new Set(writes.map(({ method, path }) => key(method, path)));
    expect([...DIRECT_LOCKED].filter((op) => !served.has(op))).toEqual([]);
  });

  it("declares 409 on every route a CMO lock can refuse", () => {
    const locked = (method: string, path: string) =>
      // Each lock is mounted on its own router only.
      (path.startsWith("/projects/") &&
        cmoLockedProjectId(method.toUpperCase(), concrete(path)) !== null) ||
      (path.startsWith("/soko-bots/") &&
        cusoLockedBotId(method.toUpperCase(), concrete(path)) !== null) ||
      DIRECT_LOCKED.has(key(method, path));
    expect(missing("409", locked)).toEqual([]);
  });

  it("declares 403 on every /cmo write", () => {
    expect(missing("403", (_, path) => path.startsWith("/cmo/"))).toEqual([]);
  });
});
