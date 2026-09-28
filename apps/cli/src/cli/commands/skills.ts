import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandOutput } from "./command-helpers.js";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// The `skills/` directory ships beside `dist/` at the package root. The two
// candidates cover the packaged layout (dist/src/cli/commands) and running the
// TypeScript source directly (src/cli/commands).
export async function resolveSkillsDir(): Promise<string> {
  const candidates = [
    new URL("../../../skills/", import.meta.url),
    new URL("../../../../skills/", import.meta.url),
  ].map((url) => fileURLToPath(url).replace(/\/$/, ""));
  for (const candidate of candidates) {
    if (await dirExists(candidate)) return candidate;
  }
  throw new Error(
    "Bundled skills directory not found. Reinstall @masumi_network/sokosumi.",
  );
}

async function readSkill(
  skillsDir: string,
  entry: string,
): Promise<SkillInfo | null> {
  const skillPath = join(skillsDir, entry);
  let content: string;
  try {
    content = await readFile(join(skillPath, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  let name = entry;
  let description = "";
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const nameMatch = frontmatter[1].match(/^name:\s*(.+)$/m);
    const descriptionMatch = frontmatter[1].match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descriptionMatch) description = descriptionMatch[1].trim();
  }
  return { name, description, path: skillPath };
}

export async function listSkills(): Promise<{
  skillsDir: string;
  skills: SkillInfo[];
}> {
  const skillsDir = await resolveSkillsDir();
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = await readSkill(skillsDir, entry.name);
    if (info) skills.push(info);
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skillsDir, skills };
}

export interface SkillsCommandOptions {
  subcommand?: string;
  stdout: CommandOutput;
  json?: boolean;
}

export async function runSkillsCommand({
  subcommand,
  stdout,
  json = false,
}: SkillsCommandOptions): Promise<void> {
  const { skillsDir, skills } = await listSkills();

  if (subcommand === "path") {
    stdout.write(
      json ? `${JSON.stringify({ skillsDir })}\n` : `${skillsDir}\n`,
    );
    return;
  }
  if (subcommand !== undefined) {
    throw new Error(
      `Unknown skills subcommand: ${subcommand}. Use "skills" or "skills path".`,
    );
  }

  if (json) {
    stdout.write(`${JSON.stringify({ skillsDir, skills })}\n`);
    return;
  }

  const lines = [
    "Sokosumi skills bundled with this CLI:",
    "",
    ...skills.flatMap((skill) => [
      `  ${skill.name}`,
      `    ${skill.description}`,
      `    ${skill.path}`,
    ]),
    "",
    'Start with the "sokosumi" skill. Point your agent at these SKILL.md files',
    "to set up and drive Coworkers through this headless CLI.",
  ];
  stdout.write(`${lines.join("\n")}\n`);
}
