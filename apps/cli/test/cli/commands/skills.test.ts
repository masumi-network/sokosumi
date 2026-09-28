import assert from "node:assert/strict";
import test from "node:test";

import {
  listSkills,
  runSkillsCommand,
} from "../../../src/cli/commands/skills.js";

test("listSkills finds the bundled skills including sokosumi", async () => {
  const { skillsDir, skills } = await listSkills();
  assert.ok(skillsDir.endsWith("skills"));
  const names = skills.map((skill) => skill.name);
  assert.ok(
    names.includes("sokosumi"),
    `expected the sokosumi skill, got ${names.join(", ")}`,
  );
  const sokosumi = skills.find((skill) => skill.name === "sokosumi");
  assert.ok(sokosumi);
  assert.ok(sokosumi.description.length > 0);
  assert.ok(sokosumi.path.endsWith("sokosumi"));
});

test("skills JSON output lists skills and their directory", async () => {
  const output: string[] = [];
  await runSkillsCommand({
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  const result = JSON.parse(output.join("")) as {
    skillsDir: string;
    skills: { name: string; description: string; path: string }[];
  };
  assert.ok(result.skillsDir.endsWith("skills"));
  assert.ok(result.skills.some((skill) => skill.name === "sokosumi"));
});

test("skills path prints only the skills directory", async () => {
  const output: string[] = [];
  await runSkillsCommand({
    subcommand: "path",
    stdout: { write: (value) => output.push(value) },
  });
  assert.ok(output.join("").trim().endsWith("skills"));
});

test("unknown skills subcommand is rejected", async () => {
  await assert.rejects(
    runSkillsCommand({
      subcommand: "bogus",
      stdout: { write: () => undefined },
    }),
    /Unknown skills subcommand/,
  );
});
