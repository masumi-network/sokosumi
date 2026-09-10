// Run from any directory after the repository's pinned pnpm install.
// This exports data for Swift; no JavaScript is shipped in the Apple app.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
const remarkRequire = createRequire(webRequire.resolve("remark-emoji"));
const emojiRequire = createRequire(remarkRequire.resolve("node-emoji"));
const emojiDirectory = dirname(emojiRequire.resolve("emojilib"));
const emoticonEntry = remarkRequire.resolve("emoticon");
const emoticonDirectory = dirname(emoticonEntry);
for (const [directory, expected] of [[emojiDirectory, "2.4.0"], [emoticonDirectory, "4.1.0"]]) {
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (metadata.version !== expected) throw new Error(`Review ${metadata.name} ${metadata.version} before updating the approved data`);
}
const { lib } = emojiRequire("emojilib");
const { emoticon } = await import(pathToFileURL(emoticonEntry).href);
const output = fileURLToPath(new URL("../Packages/SokosumiChat/Sources/SokosumiChat/Resources/Emoji/", import.meta.url));
mkdirSync(output, { recursive: true });
for (const [name, value] of [
  ["shortcodes", Object.fromEntries(Object.entries(lib).map(([key, value]) => [key, value.char]))],
  ["emoticons", emoticon.map(({ emoji, emoticons }) => ({ emoji, emoticons }))],
]) {
  const data = JSON.stringify(value) + "\n";
  writeFileSync(join(output, `${name}.json`), data);
  console.log(`${name}.json sha256 ${createHash("sha256").update(data).digest("hex")}`);
}
copyFileSync(join(emojiDirectory, "LICENSE"), join(output, "emojilib-LICENSE.txt"));
copyFileSync(join(emoticonDirectory, "license"), join(output, "emoticon-LICENSE.txt"));
