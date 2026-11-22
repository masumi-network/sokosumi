"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useSeoReportFiles } from "./use-seo-report-files";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The audit's PDF, from the files of its Task. No button while the files load or where the Task has no PDF. */
export function SeoPlanPdfLink({
  model,
  taskId,
  observedAt,
}: {
  model: SeoWorkspaceModel;
  taskId: string;
  observedAt: Date;
}) {
  const t = useTranslations("App.Seo");
  const fileText = useTranslations("Components.DocumentViewer");
  const newTabId = useId();
  const { files } = useSeoReportFiles(
    {
      model,
      versions: [
        { taskId, at: observedAt, kind: "audit_full", canRecover: false },
      ],
    },
    true,
  );
  const pdf = files?.find((file) => file.format === "pdf");
  if (!pdf) return null;
  return (
    <>
      <span className="sr-only" id={newTabId}>
        {fileText("openInNewTab")}
      </span>
      <Button size="sm" variant="outline" asChild>
        <a
          href={pdf.url}
          aria-describedby={newTabId}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText aria-hidden />
          {t("planMessage.pdf")}
          <ExternalLink aria-hidden />
        </a>
      </Button>
    </>
  );
}
