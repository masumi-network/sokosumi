import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default async function Terms() {
  const filePath = path.join(process.cwd(), "public/legal/terms-of-service.md");
  return <MarkdownFile filePath={filePath} />;
}
