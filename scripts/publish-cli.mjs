#!/usr/bin/env node

import { execFile as defaultExecFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(defaultExecFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(repoRoot, "apps", "cli");
const packageJsonPath = join(cliRoot, "package.json");
const version = JSON.parse(await readFile(packageJsonPath, "utf8")).version;
const packageName = "sokosumi";
const shouldPublish = process.argv.includes("--publish");

async function run(command, args, options = {}) {
  try {
    const result = await execFile(command, args, {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

const stageRoot = await mkdtemp(join(tmpdir(), "sokosumi-cli-release-"));

try {
  await run("pnpm", ["--filter", "sokosumi-cli", "build"]);

  const sourcePackage = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const publishPackage = { ...sourcePackage };
  delete publishPackage.private;
  delete publishPackage.devDependencies;
  delete publishPackage.scripts;
  publishPackage.name = packageName;
  publishPackage.files = ["dist", "README.md", "LICENSE"];
  publishPackage.publishConfig = { access: "public" };

  await cp(join(cliRoot, "dist"), join(stageRoot, "dist"), {
    recursive: true,
  });
  await cp(join(cliRoot, "README.md"), join(stageRoot, "README.md"));
  await cp(join(repoRoot, "LICENSE"), join(stageRoot, "LICENSE"));
  await writeFile(
    join(stageRoot, "package.json"),
    `${JSON.stringify(publishPackage, null, 2)}\n`,
  );

  const dryRun = await run(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: stageRoot },
  );
  const packInfo = JSON.parse(dryRun.stdout)[0];
  const unexpectedFiles = packInfo.files
    .map(({ path: filePath }) => filePath)
    .filter(
      (filePath) =>
        filePath !== "package.json" &&
        filePath !== "README.md" &&
        filePath !== "LICENSE" &&
        !filePath.startsWith("dist/"),
    );
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Unexpected npm package files: ${unexpectedFiles.join(", ")}`,
    );
  }

  process.stdout.write(
    `Prepared ${packageName}@${version}: ${packInfo.entryCount} files, ${packInfo.unpackedSize} bytes.\n`,
  );

  if (!shouldPublish) {
    process.stdout.write("Dry run only. Re-run with --publish to publish.\n");
  } else {
    await run("npm", ["publish", "--access", "public", "--ignore-scripts"], {
      cwd: stageRoot,
    });
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
