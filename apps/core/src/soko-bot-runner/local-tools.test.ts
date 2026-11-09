import { mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it } from "vitest";

import {
  citableSources,
  htmlToText,
  readWorkspaceUpload,
  runCommand,
  WORKSPACE,
  workspacePath,
} from "./local-tools";

describe("workspace paths", () => {
  it("resolves paths inside the workspace", () => {
    expect(workspacePath("notes/a.md")).toBe(`${WORKSPACE}/notes/a.md`);
    expect(workspacePath()).toBe(WORKSPACE);
  });

  it.each(["../escape.txt", "/etc/passwd", "notes/../../x"])(
    "refuses %s",
    (path) => {
      expect(() => workspacePath(path)).toThrow("outside the workspace");
    },
  );
});

describe("workspace files for upload_file", () => {
  const dir = ".upload-test";
  afterAll(() => rm(workspacePath(dir), { recursive: true, force: true }));

  it("reads a rendered file", async () => {
    await mkdir(workspacePath(dir), { recursive: true });
    await writeFile(workspacePath(`${dir}/clip.mp4`), Buffer.from([0, 1, 255]));
    expect(await readWorkspaceUpload(`${dir}/clip.mp4`)).toEqual(
      Buffer.from([0, 1, 255]),
    );
  });

  it("refuses a file over the limit before reading it, saying how to shrink it", async () => {
    await mkdir(workspacePath(dir), { recursive: true });
    await writeFile(workspacePath(`${dir}/big.mp4`), "");
    await truncate(
      workspacePath(`${dir}/big.mp4`),
      SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES + 1,
    );
    await expect(readWorkspaceUpload(`${dir}/big.mp4`)).rejects.toThrow(
      "Re-encode it smaller",
    );
  });

  it("refuses a path outside the workspace", async () => {
    await expect(readWorkspaceUpload("../../etc/passwd")).rejects.toThrow(
      "outside the workspace",
    );
  });
});

describe("html to text", () => {
  it("decodes entities once", () => {
    expect(htmlToText("<p>a &amp;lt; b &lt; c</p>")).toBe("a &lt; b < c");
  });
});

describe("commands", () => {
  it("kills a whole pipeline on timeout, not just bash", async () => {
    const started = Date.now();
    const result = await runCommand({
      command: "sleep 30 | cat",
      timeoutSeconds: 1,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.stderr).toContain("[killed after 1s]");
  });

  it("passes only the env it is given, not the runner's", async () => {
    process.env.SOKO_BOT_SECRET_FOR_TEST = "leak";
    const result = await runCommand(
      { command: 'echo "$SOKO_TOOLS_URL|$SOKO_BOT_SECRET_FOR_TEST"' },
      { SOKO_TOOLS_URL: "https://core.test/tools" },
    );
    delete process.env.SOKO_BOT_SECRET_FOR_TEST;
    expect(result.stdout.trim()).toBe("https://core.test/tools|");
  });

  it("keeps the sandbox's CA trust, so scripts can reach Core", async () => {
    process.env.NODE_EXTRA_CA_CERTS = "/etc/sandbox-ca.pem";
    const result = await runCommand({ command: 'echo "$NODE_EXTRA_CA_CERTS"' });
    delete process.env.NODE_EXTRA_CA_CERTS;
    expect(result.stdout.trim()).toBe("/etc/sandbox-ca.pem");
  });
});

describe("citableSources", () => {
  it("counts every search result", () => {
    expect(
      citableSources("web_search", {
        query: "token2049",
        results: [
          {
            results: [
              { url: "https://www.token2049.com/singapore" },
              { url: "https://example.org/a" },
            ],
          },
        ],
      }),
    ).toEqual(["https://www.token2049.com/singapore", "https://example.org/a"]);
  });

  it("counts a fetched page only when it loaded with content", () => {
    const page = { url: "https://example.org/a", contentType: "text/html" };
    expect(
      citableSources("web_fetch", { ...page, status: 200, text: "Dates" }),
    ).toEqual(["https://example.org/a"]);
    expect(
      citableSources("web_fetch", { ...page, status: 403, text: "Denied" }),
    ).toEqual([]);
    expect(
      citableSources("web_fetch", { ...page, status: 202, text: " " }),
    ).toEqual([]);
    expect(citableSources("web_fetch", { error: "timeout" })).toEqual([]);
  });

  it("gives nothing for tools that read no web page", () => {
    expect(citableSources("bash", { stdout: "https://x.example" })).toEqual([]);
  });
});
