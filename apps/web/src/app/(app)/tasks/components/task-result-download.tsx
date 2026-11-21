"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { useExportMarkdownFile } from "@/components/jobs/job-details/download-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Downloads a Task's result as a PDF or Word file named after the Task, to hand on outside Sokosumi. */
export function TaskResultDownload({
  markdown,
  fileName,
}: {
  markdown: string;
  fileName: string;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  const exportAs = useExportMarkdownFile(markdown, fileName);
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            <Download aria-hidden className="size-4" />
            {t("download")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportAs("pdf")}>
            {t("exportAsPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportAs("docx")}>
            {t("exportAsDocx")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
