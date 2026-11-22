import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { TaskResultDownload } from "./task-result-download";

/**
 * The action below a Task's done comment. A result with its own page links to it: its done comment only
 * says that the work is done, so an export of that comment holds no result. A plain result offers its export.
 */
export function TaskResultAction({
  link,
  markdown,
  fileName,
}: {
  link?: { href: string; label: string };
  markdown: string;
  fileName: string;
}) {
  if (!link)
    return <TaskResultDownload markdown={markdown} fileName={fileName} />;
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline" size="sm">
        <Link href={link.href}>
          {link.label}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
