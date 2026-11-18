import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { sokoBotJudgeVerdictSchema } from "@sokosumi/soko-bot";
import { z } from "zod";

// `claude --json-schema` refuses Zod's default 2020-12 dialect.
const VERDICT_JSON_SCHEMA = JSON.stringify(
  z.toJSONSchema(sokoBotJudgeVerdictSchema, { target: "draft-7" }),
);

// An API key in Core's environment would bill the API instead of the
// subscription the local judge is meant to run on.
const API_BILLING_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
];

function subscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of API_BILLING_KEYS) delete env[key];
  return env;
}

function runClaude(
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      args,
      {
        // Away from the repository, so no project instructions reach the judge.
        cwd: tmpdir(),
        env: subscriptionEnv(),
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const reason = error.killed
          ? `timed out after ${timeoutMs} ms`
          : stderr.trim().slice(0, 300) || String(error.code ?? error.message);
        reject(new Error(`The claude CLI did not return a verdict: ${reason}`));
      },
    );
    child.stdin?.end(input);
  });
}

/**
 * One judge call through the local Claude Code CLI: no tools, no settings,
 * no MCP servers, the rubric as the whole system prompt. Returns the
 * structured output unparsed; the caller checks it against the verdict schema.
 */
export async function runClaudeCodeJudge(options: {
  model: string;
  instructions: string;
  prompt: string;
  timeoutMs: number;
}): Promise<unknown> {
  const stdout = await runClaude(
    [
      "--print",
      "--output-format",
      "json",
      "--model",
      options.model,
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--system-prompt",
      options.instructions,
      "--json-schema",
      VERDICT_JSON_SCHEMA,
    ],
    options.prompt,
    options.timeoutMs,
  );
  const parsed: unknown = JSON.parse(stdout);
  // The CLI prints one result, or every message with the result last.
  const result: unknown = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (
    typeof result !== "object" ||
    result === null ||
    !("structured_output" in result) ||
    ("is_error" in result && result.is_error === true)
  ) {
    throw new Error("The claude CLI returned no structured verdict");
  }
  return result.structured_output;
}
