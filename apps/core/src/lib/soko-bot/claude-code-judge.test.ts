import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { runClaudeCodeJudge } from "./claude-code-judge";

const VERDICT = {
  scores: { delegation: 4, followThrough: 4, judgment: 4, honesty: 5 },
  verdict: "pass",
  rationale: "Claims matched the tool results.",
  issues: [],
};

const stdinEnd = vi.fn();

type ExecCallback = (
  error: (Error & { killed?: boolean; code?: number }) | null,
  stdout: string,
  stderr: string,
) => void;

function cliAnswers(
  error: Parameters<ExecCallback>[0],
  stdout: string,
  stderr = "",
) {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => {
    queueMicrotask(() => callback(error, stdout, stderr));
    return { stdin: { end: stdinEnd } };
  }) as unknown as typeof execFile);
}

function judge() {
  return runClaudeCodeJudge({
    model: "claude-opus-5-5",
    instructions: "the rubric",
    prompt: '{"turn":"transcript"}',
    timeoutMs: 90_000,
  });
}

describe("runClaudeCodeJudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends the prompt on stdin and reads the verdict from the last message", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "an-api-key");
    cliAnswers(
      null,
      JSON.stringify([
        { type: "system" },
        { type: "result", is_error: false, structured_output: VERDICT },
      ]),
    );

    await expect(judge()).resolves.toEqual(VERDICT);

    expect(stdinEnd).toHaveBeenCalledWith('{"turn":"transcript"}');
    const [file, args, options] = vi.mocked(execFile).mock.calls[0] ?? [];
    expect(file).toBe("claude");
    expect(args).toEqual(
      expect.arrayContaining([
        "--print",
        "--model",
        "claude-opus-5-5",
        "--system-prompt",
        "the rubric",
      ]),
    );
    // No tools: the judge only reads the transcript.
    expect(args?.[(args?.indexOf("--tools") ?? 0) + 1]).toBe("");
    const schema = JSON.parse(
      args?.[(args?.indexOf("--json-schema") ?? 0) + 1] ?? "{}",
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(["scores", "verdict"]),
    );
    expect(options).toMatchObject({ timeout: 90_000 });
    // The subscription pays, not an API key Core happens to hold.
    expect(
      (options as { env: NodeJS.ProcessEnv }).env.ANTHROPIC_API_KEY,
    ).toBeUndefined();
  });

  it("reads a single result object too", async () => {
    cliAnswers(null, JSON.stringify({ structured_output: VERDICT }));
    await expect(judge()).resolves.toEqual(VERDICT);
  });

  it("fails when the CLI reports an error result", async () => {
    cliAnswers(
      null,
      JSON.stringify({ is_error: true, structured_output: null }),
    );
    await expect(judge()).rejects.toThrow("no structured verdict");
  });

  it("fails with the CLI's own words when it exits with an error", async () => {
    cliAnswers(
      Object.assign(new Error("Command failed"), { code: 1 }),
      "",
      "Not logged in",
    );
    await expect(judge()).rejects.toThrow("Not logged in");
  });

  it("says so when the CLI timed out", async () => {
    cliAnswers(Object.assign(new Error("killed"), { killed: true }), "");
    await expect(judge()).rejects.toThrow("timed out after 90000 ms");
  });

  it("forwards a custom jsonSchema when supplied", async () => {
    const customSchema = JSON.stringify({
      type: "object",
      required: ["pass", "reason"],
    });
    cliAnswers(
      null,
      JSON.stringify({ structured_output: { pass: true, reason: "ok" } }),
    );
    await expect(
      runClaudeCodeJudge({
        model: "claude-opus-5-5",
        instructions: "grade item",
        prompt: "item 1",
        timeoutMs: 90_000,
        jsonSchema: customSchema,
      }),
    ).resolves.toEqual({ pass: true, reason: "ok" });
    const [, args] = vi.mocked(execFile).mock.calls[0] ?? [];
    expect(args?.[(args?.indexOf("--json-schema") ?? 0) + 1]).toBe(
      customSchema,
    );
  });

  it("writes large system prompts to a temp file and deletes it even on failure", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    let capturedPath: string | null = null;
    let capturedContent = "";
    vi.mocked(execFile).mockImplementation(((
      _file: string,
      args: string[],
      _options: unknown,
      callback: ExecCallback,
    ) => {
      const idx = args.indexOf("--system-prompt-file");
      capturedPath = idx >= 0 ? (args[idx + 1] ?? null) : null;
      if (capturedPath) capturedContent = readFileSync(capturedPath, "utf8");
      queueMicrotask(() =>
        callback(
          Object.assign(new Error("Command failed"), { code: 1 }),
          "",
          "boom",
        ),
      );
      return { stdin: { end: stdinEnd } };
    }) as unknown as typeof execFile);

    const bigPrompt = "x".repeat(190_000);
    await expect(
      runClaudeCodeJudge({
        model: "claude-opus-5-5",
        instructions: bigPrompt,
        prompt: "item",
        timeoutMs: 90_000,
      }),
    ).rejects.toThrow("boom");
    expect(capturedPath).toBeTruthy();
    expect(capturedContent).toBe(bigPrompt);
    expect(capturedPath && existsSync(capturedPath)).toBe(false);
  });
});
