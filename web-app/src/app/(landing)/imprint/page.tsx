import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default function Imprint() {
  const fileSystemPath = path.join(process.cwd(), "public/legal/imprint.md");
  return <MarkdownFile fileSystemPath={fileSystemPath} />;
}
