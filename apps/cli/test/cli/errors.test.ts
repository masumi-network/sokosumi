import assert from "node:assert/strict";
import test from "node:test";

import { createApiError } from "../../src/api/http-client.js";
import {
  buildJsonError,
  CliError,
  classifyError,
  EXIT_CODES,
} from "../../src/cli/errors.js";

test("CliError carries its code through classifyError", () => {
  const auth = classifyError(new CliError("AUTH_REQUIRED", "login first"));
  assert.equal(auth.code, "AUTH_REQUIRED");
  assert.equal(auth.exitCode, EXIT_CODES.AUTH_REQUIRED);

  const validation = classifyError(new CliError("VALIDATION", "bad flag"));
  assert.equal(validation.code, "VALIDATION");
  assert.equal(validation.exitCode, EXIT_CODES.VALIDATION);
});

test("API errors classify by HTTP status", () => {
  const cases: [number, string, number][] = [
    [401, "AUTH_REQUIRED", EXIT_CODES.AUTH_REQUIRED],
    [403, "PERMISSION_DENIED", EXIT_CODES.PERMISSION_DENIED],
    [404, "NOT_FOUND", EXIT_CODES.NOT_FOUND],
    [400, "VALIDATION", EXIT_CODES.VALIDATION],
    [422, "VALIDATION", EXIT_CODES.VALIDATION],
    [500, "API_ERROR", EXIT_CODES.API_ERROR],
  ];
  for (const [status, code, exit] of cases) {
    const result = classifyError(createApiError(status, { detail: "x" }));
    assert.equal(result.code, code, `status ${status}`);
    assert.equal(result.exitCode, exit, `status ${status} exit`);
    assert.equal(result.status, status);
  }
});

test("network failures classify as NETWORK", () => {
  const error = new TypeError("fetch failed");
  Object.defineProperty(error, "cause", { value: { code: "ECONNREFUSED" } });
  const result = classifyError(error);
  assert.equal(result.code, "NETWORK");
  assert.equal(result.exitCode, EXIT_CODES.NETWORK);
});

test("unclassified errors fall back to UNKNOWN with exit 1", () => {
  const result = classifyError(new Error("something odd"));
  assert.equal(result.code, "UNKNOWN");
  assert.equal(result.exitCode, 1);
});

test("buildJsonError includes code, and status only for API errors", () => {
  const apiPayload = buildJsonError(
    "denied",
    createApiError(403, { detail: "nope" }),
  );
  assert.deepEqual(apiPayload, {
    error: "denied",
    code: "PERMISSION_DENIED",
    status: 403,
  });

  const localPayload = buildJsonError(
    "login first",
    new CliError("AUTH_REQUIRED", "login first"),
  );
  assert.deepEqual(localPayload, {
    error: "login first",
    code: "AUTH_REQUIRED",
  });
  assert.equal("status" in localPayload, false);
});
