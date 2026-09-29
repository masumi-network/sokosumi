import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test, { type TestContext } from "node:test";

import {
  executeHermesTask,
  type HermesRuntimeOptions,
  preflightHermesRuntime,
} from "../../src/coworker/hermes-runtime.js";
import type { RuntimeTask } from "../../src/coworker/runtime-task.js";

const TASK: RuntimeTask = {
  id: "task-id",
  name: "Summarize the supplied text",
  description:
    'A quoted "line" with $(not-a-command), `backticks`, and\na newline.',
  assigneeId: "coworker-id",
  organizationId: "organization-id",
  status: "READY",
};
const RESULT = JSON.stringify({
  type: "result",
  exit_code: 0,
  text: "Finished.",
});
const POSIX_ONLY = {
  skip:
    process.platform === "win32"
      ? "Fixture uses a POSIX executable script."
      : false,
};

async function fixture(
  context: TestContext,
  body: string,
): Promise<HermesRuntimeOptions> {
  const directory = await mkdtemp(join(tmpdir(), "sokosumi-hermes-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "hermes.cjs");
  await writeFile(executable, `#!${process.execPath}\n${body}\n`, {
    mode: 0o700,
  });
  return {
    provider: "openrouter",
    model: "test/model",
    hermesPath: executable,
    runtimeDirectory: directory,
    hermesHome: directory,
    timeoutMs: 5_000,
  };
}

test(
  "§V2/§V78: sends literal Task text on stdin and filters the Hermes environment",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(
      context,
      `
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => {
      process.stdout.write(JSON.stringify({type:'system', subtype:'init'}) + '\\n');
      process.stdout.write(JSON.stringify({type:'result', exit_code:0, text:JSON.stringify({
        input, args:process.argv.slice(2), environment:process.env
      })}) + '\\n');
    });
  `,
    );
    const secrets = {
      SOKOSUMI_COWORKER_API_KEY: "coworker_do-not-forward",
      SOKOSUMI_API_KEY: "soko_preprod_do-not-forward",
      UNRELATED_TOKEN: "other-do-not-forward",
      NODE_OPTIONS: "--no-warnings",
      HERMES_YOLO_MODE: "1",
      HERMES_KANBAN_TASK: "other-task",
      HERMES_SAFE_MODE: "1",
      HERMES_IGNORE_RULES: "1",
      HERMES_IGNORE_USER_CONFIG: "1",
      HERMES_INFERENCE_MODEL: "other/model",
      HERMES_INFERENCE_PROVIDER: "other-provider",
      ANTHROPIC_API_KEY: "other-provider-secret",
      OPENROUTER_API_KEY: "allowed-provider-secret",
    };
    for (const [key, value] of Object.entries(secrets)) {
      const previous = process.env[key];
      process.env[key] = value;
      context.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      });
    }
    const actual = JSON.parse(
      await executeHermesTask({ ...options, task: TASK }),
    );
    const instruction = actual.input.split("\n")[0];
    assert.equal(
      instruction,
      "Complete this Task and return the finished result as your final response.",
    );
    assert.equal(
      actual.input.split("\n").slice(1).join("\n"),
      JSON.stringify({ name: TASK.name, description: TASK.description }),
    );
    assert.deepEqual(actual.args, [
      "--profile",
      "default",
      "--cli",
      "chat",
      "--query-file",
      "-",
      "--oneshot",
      "--format",
      "stream-json",
      "--source",
      "tool",
      "--max-turns",
      "10",
      "--provider",
      "openrouter",
      "--model",
      "test/model",
    ]);
    assert.equal(actual.environment.HERMES_HOME, options.hermesHome);
    assert.equal(
      actual.environment.OPENROUTER_API_KEY,
      secrets.OPENROUTER_API_KEY,
    );
    for (const key of Object.keys(secrets).filter(
      (key) => key !== "OPENROUTER_API_KEY",
    )) {
      assert.equal(actual.environment[key], undefined, key);
    }
    assert.equal(typeof TASK.description, "string");
    assert.ok(!JSON.stringify(actual.args).includes(TASK.description ?? ""));
    assert.ok(!actual.input.includes(TASK.organizationId));
  },
);

for (const overrides of [
  {},
  { model: "override/model" },
  { provider: "anthropic" },
]) {
  test(
    `§V77/§V78: leaves profile configuration enabled with ${JSON.stringify(overrides)} overrides`,
    POSIX_ONLY,
    async (context) => {
      const options = await fixture(
        context,
        `
      const args = process.argv.slice(2);
      if (args.includes('--safe-mode') || args.includes('--toolsets') || args.includes('--ignore-rules') || args.includes('--ignore-user-config')) process.exit(94);
      if (args.includes('--help')) console.log('--query-file --oneshot --format stream-json --source --max-turns --provider --model');
      else if (args.includes('--version')) console.log('Hermes fixture version');
      else {
        process.stdin.resume();
        process.stdin.on('end', () => console.log(JSON.stringify({type:'result', exit_code:0, text:JSON.stringify({args, environment:process.env})})));
      }
    `,
      );
      for (const name of [
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "SOKOSUMI_COWORKER_API_KEY",
      ]) {
        const previous = process.env[name];
        process.env[name] = "parent-secret";
        context.after(() => {
          if (previous === undefined) delete process.env[name];
          else process.env[name] = previous;
        });
      }
      const configured = {
        ...options,
        provider: undefined,
        model: undefined,
        ...overrides,
      };
      await preflightHermesRuntime(configured);
      const actual = JSON.parse(
        await executeHermesTask({ ...configured, task: TASK }),
      );
      assert.deepEqual(actual.args, [
        "--profile",
        "default",
        "--cli",
        "chat",
        "--query-file",
        "-",
        "--oneshot",
        "--format",
        "stream-json",
        "--source",
        "tool",
        "--max-turns",
        "10",
        ...(configured.provider === undefined
          ? []
          : ["--provider", configured.provider]),
        ...(configured.model === undefined
          ? []
          : ["--model", configured.model]),
      ]);
      assert.equal(actual.environment.HERMES_HOME, options.hermesHome);
      assert.equal(actual.environment.OPENROUTER_API_KEY, undefined);
      assert.equal(actual.environment.OPENAI_API_KEY, undefined);
      assert.equal(actual.environment.SOKOSUMI_COWORKER_API_KEY, undefined);
      assert.equal(
        actual.environment.ANTHROPIC_API_KEY,
        configured.provider === "anthropic" ? "parent-secret" : undefined,
      );
    },
  );
}

test(
  "§V66: preflight verifies flags without submitting a prompt",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(
      context,
      `
    const args = process.argv.slice(2);
    if (args.shift() !== '--profile' || args.shift() !== 'default') process.exit(91);
    if (args.join(' ') === '--version') console.log('Hermes fixture version');
    else if (args.join(' ') === '--cli chat --help') console.log('--query-file --oneshot --format stream-json --safe-mode --source --toolsets --max-turns --provider --model');
    else process.exit(90);
  `,
    );
    await preflightHermesRuntime(options);
  },
);

for (const namedProfile of [false, true]) {
  test(
    `§V78: pins the configured Hermes ${namedProfile ? "named profile" : "home"} despite active_profile`,
    POSIX_ONLY,
    async (context) => {
      const options = await fixture(
        context,
        `
      const fs = require('node:fs');
      const path = require('node:path');
      const args = process.argv.slice(2);
      const home = process.env.HERMES_HOME;
      const namedProfile = path.basename(path.dirname(home)) === 'profiles';
      let selectedHome = home;
      if (args[0] === '--profile') {
        if (args.splice(0, 2)[1] !== 'default') process.exit(92);
        selectedHome = namedProfile ? path.dirname(path.dirname(home)) : home;
      } else if (!namedProfile && fs.existsSync(path.join(home, 'active_profile'))) {
        const activeProfile = fs.readFileSync(path.join(home, 'active_profile'), 'utf8').trim();
        selectedHome = path.join(home, 'profiles', activeProfile);
      }
      if (selectedHome !== home) process.exit(93);
      if (args.join(' ') === '--version') console.log('Hermes fixture version');
      else if (args.join(' ') === '--cli chat --help') console.log('--query-file --oneshot --format stream-json --safe-mode --source --toolsets --max-turns --provider --model');
      else {
        process.stdin.resume();
        process.stdin.on('end', () => console.log(JSON.stringify({type:'result', exit_code:0, text:home})));
      }
    `,
      );
      const home = namedProfile
        ? `${options.runtimeDirectory}/home/../profiles/developer/`
        : `${options.runtimeDirectory}/profiles/../home/`;
      await mkdir(normalize(home), { recursive: true });
      await writeFile(join(normalize(home), "active_profile"), "unexpected");
      const configured = { ...options, hermesHome: home };
      await preflightHermesRuntime(configured);
      assert.equal(
        await executeHermesTask({ ...configured, task: TASK }),
        normalize(home),
      );
    },
  );
}

test(
  "§V66: rejects an installation without the required output protocol",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(
      context,
      "console.log('old hermes version');",
    );
    await assert.rejects(
      preflightHermesRuntime(options),
      /required one-shot JSON interface/,
    );
  },
);

test("§V78: rejects invalid runtime settings before starting Hermes", async () => {
  const options = {
    provider: "openrouter",
    model: "test/model",
    runtimeDirectory: ".",
    hermesHome: ".",
  };
  await assert.rejects(preflightHermesRuntime(options), /absolute paths/);
  await assert.rejects(
    preflightHermesRuntime({ ...options, provider: " " }),
    /nonempty identifiers/,
  );
  await assert.rejects(
    preflightHermesRuntime({ ...options, model: "bad\nmodel" }),
    /nonempty identifiers/,
  );
  await assert.rejects(
    preflightHermesRuntime({ ...options, hermesPath: "./hermes" }),
    /absolute path or hermes/,
  );
  await assert.rejects(
    preflightHermesRuntime({ ...options, timeoutMs: 0 }),
    /positive bounded integer/,
  );
  await assert.rejects(
    preflightHermesRuntime({
      ...options,
      runtimeDirectory: tmpdir(),
      hermesHome: join(tmpdir(), "home "),
    }),
    /must not start or end with whitespace/,
  );
});

test(
  "§V66: rejects missing directories and executable with a safe error",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(context, "process.exit(0);");
    await assert.rejects(
      preflightHermesRuntime({
        ...options,
        runtimeDirectory: join(options.runtimeDirectory, "missing"),
      }),
      /must already exist/,
    );
    await assert.rejects(
      preflightHermesRuntime({
        ...options,
        hermesPath: join(options.runtimeDirectory, "missing"),
      }),
      /Hermes could not start/,
    );
  },
);

for (const [name, output, error] of [
  ["missing result", '{"type":"text","text":"unfinished"}', /no final result/],
  ["malformed JSON", "private diagnostic secret", /invalid JSON output/],
  ["invalid event", "null", /invalid event sequence/],
  ["duplicate result", `${RESULT}\n${RESULT}`, /invalid event sequence/],
  [
    "event after result",
    `${RESULT}\n{"type":"text","text":"late"}`,
    /invalid event sequence/,
  ],
  [
    "failed result",
    '{"type":"result","exit_code":1,"text":"private diagnostic secret"}',
    /successful final result/,
  ],
  [
    "empty result",
    '{"type":"result","exit_code":0,"text":"  "}',
    /successful final result/,
  ],
  [
    "error with success",
    '{"type":"result","exit_code":0,"text":"done","error":"private diagnostic secret"}',
    /successful final result/,
  ],
] as const) {
  test(
    `§V66/§V78: rejects ${name} without exposing child output`,
    POSIX_ONLY,
    async (context) => {
      const options = await fixture(
        context,
        `process.stdout.write(${JSON.stringify(output)});`,
      );
      await assert.rejects(
        executeHermesTask({ ...options, task: TASK }),
        (actual: Error) => {
          assert.match(actual.message, error);
          assert.ok(!actual.message.includes("private diagnostic secret"));
          return true;
        },
      );
    },
  );
}

test(
  "§V66: requires successful child exit even with a valid result",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(
      context,
      `console.log(${JSON.stringify(RESULT)}); console.error('private diagnostic secret'); process.exitCode = 1;`,
    );
    await assert.rejects(
      executeHermesTask({ ...options, task: TASK }),
      /Hermes did not complete successfully/,
    );
  },
);

for (const stream of ["stdout", "stderr"]) {
  test(`§V78: bounds Hermes ${stream}`, POSIX_ONLY, async (context) => {
    const options = await fixture(
      context,
      `process.${stream}.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000);`,
    );
    await assert.rejects(
      executeHermesTask({ ...options, task: TASK }),
      /exceeded the allowed size/,
    );
  });
}

test("§V66: kills a timed out runtime", POSIX_ONLY, async (context) => {
  const options = await fixture(context, "setInterval(() => {}, 1000);");
  await assert.rejects(
    executeHermesTask({ ...options, timeoutMs: 50, task: TASK }),
    /timed out/,
  );
});

test(
  "§V66: aborts a running runtime and rejects an already aborted call",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(context, "setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const operation = executeHermesTask({
      ...options,
      signal: controller.signal,
      task: TASK,
    });
    const timer = setTimeout(() => controller.abort(), 50);
    context.after(() => clearTimeout(timer));
    await assert.rejects(operation, /aborted/);
    await assert.rejects(
      executeHermesTask({ ...options, signal: controller.signal, task: TASK }),
      /aborted/,
    );
  },
);

test(
  "§V66: rejects oversized Task input before starting a model",
  POSIX_ONLY,
  async (context) => {
    const options = await fixture(context, "process.exit(90);");
    await assert.rejects(
      executeHermesTask({
        ...options,
        task: { ...TASK, description: "x".repeat(300 * 1024) },
      }),
      /input limit/,
    );
  },
);
