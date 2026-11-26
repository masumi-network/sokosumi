import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

const API = ["--api-url", "https://fixture.invalid"];
const UPLOAD_URL =
  "https://store.public.blob.vercel-storage.com/users/u-1/e2e-ws.txt?vercel-blob-delegation=x";

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

async function textFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sokosumi-upload-"));
  const path = join(dir, "e2e-ws.txt");
  await writeFile(path, "hello e2e workspaces\n");
  return path;
}

function fixture(t: TestContext, blobStatus = 200) {
  const output: string[] = [];
  const calls: Call[] = [];
  const deps: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      const body = init?.body;
      calls.push({
        method: init?.method ?? "GET",
        url,
        authorization: headers.get("Authorization"),
        contentType: headers.get("Content-Type"),
        body:
          typeof body === "string"
            ? JSON.parse(body)
            : body instanceof Uint8Array
              ? Buffer.from(body).toString("utf8")
              : body,
      });
      if (url.startsWith("https://fixture.invalid/"))
        return Response.json({
          data: {
            uploadUrl: UPLOAD_URL,
            pathname: "users/u-1/e2e-ws.txt",
            access: "public",
            method: "PUT",
            headers: { "Content-Type": "text/plain" },
            expiresAt: "2026-11-26T12:17:36.000Z",
            maxSizeBytes: 21,
            addRandomSuffix: true,
          },
        });
      if (blobStatus !== 200)
        return new Response("denied", { status: blobStatus });
      // Blob's signed-URL PUT answers with the stored URL; the random suffix is only there.
      return Response.json({
        url: "https://store.public.blob.vercel-storage.com/users/u-1/e2e-ws-a1b2.txt",
        contentType: "text/plain",
      });
    },
  );
  return { deps, output, calls };
}

test("users file-upload --file asks Core for the upload, then PUTs the bytes to Blob (SOKD-470)", async (t) => {
  const path = await textFile();
  const f = fixture(t);
  await runCli(
    [...API, "users", "file-upload", "me", "--file", path, "--json"],
    f.deps,
  );
  assert.deepEqual(f.calls, [
    {
      method: "POST",
      url: "https://fixture.invalid/v1/users/me/files",
      authorization: "Bearer fixture-token",
      contentType: "application/json",
      body: {
        filename: "e2e-ws.txt",
        contentType: "application/octet-stream",
        size: 21,
      },
    },
    {
      method: "PUT",
      url: UPLOAD_URL,
      authorization: null,
      contentType: "text/plain",
      body: "hello e2e workspaces\n",
    },
  ]);
  assert.deepEqual(JSON.parse(f.output.join("")), {
    file: {
      name: "e2e-ws.txt",
      url: "https://store.public.blob.vercel-storage.com/users/u-1/e2e-ws-a1b2.txt",
      pathname: "users/u-1/e2e-ws-a1b2.txt",
      contentType: "text/plain",
      size: 21,
    },
  });
});

test("users file-upload needs --file and refuses --input-json", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runCli([...API, "users", "file-upload", "me"], f.deps),
    /--file PATH is required/,
  );
  await assert.rejects(
    runCli(
      [...API, "users", "file-upload", "me", "--input-json", "{}"],
      f.deps,
    ),
    /does not take --input-json/,
  );
  assert.deepEqual(f.calls, []);
});

test("users file-upload refuses a directory before asking Core", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runCli([...API, "users", "file-upload", "me", "--file", tmpdir()], f.deps),
    /--file must be a file/,
  );
  assert.deepEqual(f.calls, []);
});

test("users file-upload reports a failed Blob PUT", async (t) => {
  const path = await textFile();
  const f = fixture(t, 403);
  await assert.rejects(
    runCli([...API, "users", "file-upload", "me", "--file", path], f.deps),
    /Blob upload failed with status 403/,
  );
});
