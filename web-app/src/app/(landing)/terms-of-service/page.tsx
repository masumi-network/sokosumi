import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default function Terms() {
  const fileSystemPath = path.join(
    process.cwd(),
    "public/legal/terms-of-service.md",
  );
  return <MarkdownFile fileSystemPath={fileSystemPath} />;
}
