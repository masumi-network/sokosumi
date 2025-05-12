import path from "path";

import MarkdownFile from "@/components/markdown-file";

export default function Privacy() {
  const fileSystemPath = path.join(
    process.cwd(),
    "public/legal/privacy-policy.md",
  );
  return <MarkdownFile fileSystemPath={fileSystemPath} />;
}
