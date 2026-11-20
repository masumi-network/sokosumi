"use client";

import { ExternalLink, Files } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SEO_RESULT_LOCALE } from "@/i18n/seo-result-messages";
import { SeoAuditSearchConsole } from "./seo-audit-search-console";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  type SeoReportFileProps,
  useSeoReportFiles,
} from "./use-seo-report-files";

export function SeoReportFiles({ model, versions }: SeoReportFileProps) {
  const t = useTranslations("App.Seo.reportFiles");
  const hasEvidence = versions.some(
    ({ taskId }) =>
      model.data.auditSearchConsole?.some((entry) => entry.taskId === taskId) ||
      model.data.auditSearchConsoleRetryTaskIds?.includes(taskId),
  );
  const title = t(hasEvidence ? "withSearchConsole" : "title");
  const trigger = (
    <Button size="sm" variant="ghost" disabled={!versions.length}>
      <Files aria-hidden />
      {title}
    </Button>
  );
  if (!versions.length) return trigger;
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <SeoReportFileSelection model={model} versions={versions} />
      </DialogContent>
    </Dialog>
  );
}

function SeoReportFileSelection({ model, versions }: SeoReportFileProps) {
  const t = useTranslations("App.Seo");
  const fileText = useTranslations("Components.DocumentViewer");
  const id = useId();
  const newTabId = useId();
  const {
    taskId,
    options,
    setPicked,
    files,
    error,
    retry,
    refreshing,
    importReport,
    evidence,
    fullAudit,
    recoverSearch,
    recovering,
    recoveryFailed,
  } = useSeoReportFiles({ model, versions });
  return (
    <>
      {options.length > 1 ? (
        <SeoField id={id} label={t("reportFiles.run")}>
          <SeoSelect
            lang={SEO_RESULT_LOCALE}
            id={id}
            options={options}
            value={taskId}
            onValueChange={setPicked}
          />
        </SeoField>
      ) : (
        <p lang={SEO_RESULT_LOCALE} className="text-muted-foreground text-sm">
          {options[0].label}
        </p>
      )}
      {(model.data.history.evidenceLimited ?? model.data.history.limited) && (
        <p className="text-muted-foreground text-sm">
          {t("reportFiles.historyLimit")}
        </p>
      )}
      {evidence ? (
        <SeoAuditSearchConsole evidence={evidence} />
      ) : fullAudit || recoverSearch ? (
        <p className="text-muted-foreground text-sm">
          {t("reportFiles.missingSearchConsole")}
        </p>
      ) : null}
      {recoverSearch && (
        <div className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={recovering}
            onClick={recoverSearch}
          >
            {t("reportFiles.recoverSearch")}
          </Button>
          {recoveryFailed && (
            <p role="alert" className="text-destructive text-sm">
              {t("reportFiles.recoverSearchFailed")}
            </p>
          )}
        </div>
      )}
      {importReport ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {t("reportFiles.importHelp")}
          </p>
          <Button
            size="sm"
            loading={model.pending}
            onClick={() => void importReport()}
          >
            {t("reportFiles.import")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {t(`reportFiles.${error}`)}
          </p>
          {retry ? (
            <Button size="sm" variant="outline" onClick={() => void retry()}>
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : !files ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("reportFiles.loading")}
        </p>
      ) : files.length ? (
        <div>
          <span className="sr-only" id={newTabId}>
            {fileText("openInNewTab")}
          </span>
          <ul className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <li key={file.id}>
                <Button
                  size="sm"
                  variant={!importReport && index === 0 ? "default" : "outline"}
                  asChild
                >
                  <a
                    href={file.url}
                    aria-describedby={newTabId}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t(`reportFiles.${file.format}`)}
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p role="status" className="text-muted-foreground text-sm">
          {t("reportFiles.empty")}
        </p>
      )}
      {!error &&
      files &&
      files.every((file) => file.format === "json") &&
      retry ? (
        <Button
          size="sm"
          variant="outline"
          loading={refreshing}
          onClick={() => void retry()}
        >
          {t("reportFiles.refresh")}
        </Button>
      ) : null}
    </>
  );
}
