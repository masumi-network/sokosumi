import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default async function Imprint() {
  const filePath = path.join(process.cwd(), "public/legal/imprint.md");
  return <MarkdownFile filePath={filePath} />;
}
