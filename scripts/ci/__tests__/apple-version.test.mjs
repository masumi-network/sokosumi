import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const appleDir = path.join(repoRoot, "apps/apple");

const config = JSON.parse(
  await readFile(path.join(appleDir, "release-please-config.json"), "utf8"),
);
const mac = config.packages["apps/apple"];
const pbxproj = await readFile(
  path.join(appleDir, "Sokosumi.xcodeproj/project.pbxproj"),
  "utf8",
);

/** Release Please's generic updater (src/updaters/generic.ts, v17). */
const VERSION_REGEX =
  /(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(-(?<preRelease>[\w.]+))?(\+(?<build>[-\w.]+))?/;

function bumpMarkedLines(text, version) {
  let inBlock = false;
  return text
    .split("\n")
    .map((line) => {
      if (line.includes("x-release-please-start-version")) {
        inBlock = true;
        return line;
      }
      if (line.includes("x-release-please-end")) {
        inBlock = false;
        return line;
      }
      return inBlock || line.includes("x-release-please-version")
        ? line.replace(VERSION_REGEX, version)
        : line;
    })
    .join("\n");
}

function xcconfigValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*([^/\\s]+)`, "m"));
  return match?.[1];
}

/** The app target's build configurations: base xcconfig and overrides. */
function appTargetConfigurations() {
  const list = pbxproj.match(
    /Build configuration list for PBXNativeTarget "Sokosumi" \*\/ = \{[\s\S]*?buildConfigurations = \(([\s\S]*?)\);/,
  );
  assert.ok(list, "the Sokosumi app target has no configuration list");
  const ids = [...list[1].matchAll(/([0-9A-F]{24})/g)].map(([id]) => id);
  return ids.map((id) => {
    const block = pbxproj.match(
      new RegExp(
        `\\t\\t${id} /\\* (\\w+) \\*/ = \\{\\n([\\s\\S]*?)\\n\\t\\t\\};`,
      ),
    );
    assert.ok(block, `missing configuration ${id}`);
    const base = block[2].match(/baseConfigurationReference = ([0-9A-F]{24})/);
    const fileRef = base
      ? pbxproj.match(
          new RegExp(`\\t\\t${base[1]} /\\* .* \\*/ = \\{[^}]*path = ([^;]+);`),
        )
      : null;
    return {
      name: block[1],
      basePath: fileRef?.[1].replaceAll('"', ""),
      overridesVersion: /\bMARKETING_VERSION = /.test(block[2]),
    };
  });
}

describe("Mac app version", () => {
  const versionFiles = mac["extra-files"].map((file) => file.path);

  it("starts at the three-part 1.0.0 Release Please can bump", async () => {
    assert.deepEqual(versionFiles, ["Version.xcconfig"]);
    const text = await readFile(path.join(appleDir, versionFiles[0]), "utf8");
    assert.equal(xcconfigValue(text, "MARKETING_VERSION"), "1.0.0");

    const bumped = bumpMarkedLines(text, "1.2.3");
    assert.equal(xcconfigValue(bumped, "MARKETING_VERSION"), "1.2.3");
  });

  it("is read by every app build from that one file", () => {
    const configurations = appTargetConfigurations();
    assert.ok(configurations.length > 0);
    for (const { name, basePath, overridesVersion } of configurations) {
      assert.equal(basePath, versionFiles[0], `${name} must base on it`);
      assert.equal(overridesVersion, false, `${name} overrides the version`);
    }
  });
});
