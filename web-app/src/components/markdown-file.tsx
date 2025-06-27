import "server-only";

import { readFile } from "fs/promises";
import path from "path";

import Markdown from "./markdown";

export interface MarkdownFileProps {
  fileType: keyof typeof mappings;
}

const mappings = {
  "privacy-policy": "privacy-policy.md",
  "terms-of-service": "terms-of-service.md",
  imprint: "imprint.md",
};

export default async function MarkdownFile({ fileType }: MarkdownFileProps) {
  const fileSystemPath = path.join(
    process.cwd(),
    "public/legal",
    mappings[fileType],
  );
  const markdownContent = await readFile(fileSystemPath, "utf8");

  return (
    <section className="max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2">
      <Markdown>{markdownContent}</Markdown>
    </section>
  );
}
