import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A directory holding a stand-in for the caption font, so no test downloads it. */
export async function cardFontDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "card-font-"));
  await writeFile(path.join(dir, "Montserrat-Black.ttf"), "font");
  return dir;
}
