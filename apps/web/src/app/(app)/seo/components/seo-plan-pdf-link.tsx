"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useSeoReportFiles } from "./use-seo-report-files";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The audit's PDF, from the files of its Task. While the files load the button waits; a failed load offers a retry. */
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
  const { files, error, retry, refreshing } = useSeoReportFiles(
    {
      model,
      versions: [
        { taskId, at: observedAt, kind: "audit_full", canRecover: false },
      ],
    },
    true,
  );
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-sm">
          {t(`reportFiles.${error}`)}
        </p>
        {retry ? (
          <Button
            size="sm"
            variant="outline"
            loading={refreshing}
            onClick={() => void retry()}
          >
            {t("retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  if (!files) {
    return (
      <Button size="sm" variant="outline" loading>
        <FileText aria-hidden />
        {t("planMessage.pdf")}
      </Button>
    );
  }
  const pdf = files.find((file) => file.format === "pdf");
  if (!pdf) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("planMessage.pdfMissing")}
      </p>
    );
  }
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
