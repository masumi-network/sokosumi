import "server-only";

import { readFile } from "fs/promises";
import path from "path";

import { MarkdownFilePathMappings, MarkdownFileType } from "./types";

export async function readMarkdownFileContent(
  fileType: MarkdownFileType,
): Promise<string> {
  const fileSystemPath = path.join(
    process.cwd(),
    "public/legal",
    MarkdownFilePathMappings[fileType],
  );
  const markdownContent = await readFile(fileSystemPath, "utf8");
  return markdownContent;
}
