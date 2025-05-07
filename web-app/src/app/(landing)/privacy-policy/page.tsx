import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default async function Privacy() {
  const filePath = path.join(process.cwd(), "public/legal/privacy-policy.md");
  return <MarkdownFile filePath={filePath} />;
}
