"use client";

import { Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useExportMarkdownFile } from "@/components/jobs/job-details/download-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  loadProjectResults,
  type ProjectResult,
} from "@/lib/actions/project/results-action";
import { useScopedQuery } from "@/queries/scoped-queries";

import { projectResultsMarkdown } from "./project-results-model";

/**
 * Downloads the Project's finished Task results as one PDF or Word file. The
 * file goes only to the reader, and holds only Tasks Core lets them read.
 */
export function ProjectResultsDownload({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("App.Projects.Detail.results");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="hit-area self-start"
          data-testid="project-results-download"
        >
          <Download className="size-4" aria-hidden />
          {t("open")}
        </Button>
      </DialogTrigger>
      {open ? (
        <ResultsPicker projectId={projectId} projectName={projectName} />
      ) : null}
    </Dialog>
  );
}

function ResultsPicker({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("App.Projects.Detail.results");
  const format = useFormatter();
  const query = useScopedQuery({
    scope: projectId,
    queryKey: ["project-results"],
    queryFn: async () => {
      const result = await loadProjectResults({ projectId });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    },
  });
  const results = query.data ?? [];
  // Unticked rather than ticked, so every result starts in the document.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const chosen = results.filter(({ id }) => !left.has(id));

  const finished = (result: ProjectResult) =>
    t("finished", {
      date: format.dateTime(new Date(result.finishedAt), {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    });

  const exportAs = useExportMarkdownFile(
    async () =>
      projectResultsMarkdown({
        title: t("documentTitle", { name: projectName }),
        sections: chosen.map((result) => ({
          heading: result.identifier
            ? `${result.identifier} ${result.name}`
            : result.name,
          meta: finished(result),
          link: {
            label: t("openTask"),
            url: new URL(`/tasks/${result.id}`, window.location.origin).href,
          },
          body: result.result,
        })),
      }),
    t("fileName", { name: projectName }),
  );

  async function download(kind: "pdf" | "docx") {
    setBusy(kind);
    await exportAs(kind);
    setBusy(null);
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(left);
    if (checked) next.delete(id);
    else next.add(id);
    setLeft(next);
  }

  const allChecked = chosen.length === results.length;

  return (
    <DialogContent
      className="max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-lg"
      showCloseButton={busy === null}
      onEscapeKeyDown={(event) => busy && event.preventDefault()}
      onInteractOutside={(event) => busy && event.preventDefault()}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("loading")}
          </p>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-2" role="alert">
            <p className="text-sm">{t("failed")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : results.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <fieldset
            className="flex min-w-0 flex-col gap-2"
            disabled={busy !== null}
          >
            <legend className="sr-only">{t("title")}</legend>
            <div className="flex min-h-11 items-center justify-between gap-3 px-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="project-results-all"
                  className="hit-area"
                  checked={
                    allChecked
                      ? true
                      : chosen.length > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() =>
                    setLeft(
                      allChecked
                        ? new Set(results.map(({ id }) => id))
                        : new Set(),
                    )
                  }
                />
                <Label htmlFor="project-results-all">{t("selectAll")}</Label>
              </div>
              <span className="text-muted-foreground text-sm tabular-nums">
                {t("selected", { count: chosen.length, total: results.length })}
              </span>
            </div>
            <ul className="flex max-h-[45dvh] flex-col divide-y overflow-y-auto overscroll-contain rounded-lg border">
              {results.map((result) => {
                const id = `project-result-${result.id}`;
                return (
                  <li
                    key={result.id}
                    className="flex min-h-11 items-center gap-3 px-3 py-2"
                  >
                    <Checkbox
                      id={id}
                      className="hit-area"
                      checked={!left.has(result.id)}
                      onCheckedChange={(checked) =>
                        toggle(result.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={id}
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 font-normal"
                    >
                      <span className="w-full truncate text-sm font-medium">
                        {result.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {result.identifier
                          ? `${result.identifier} · ${finished(result)}`
                          : finished(result)}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            loading={busy === "docx"}
            disabled={busy === "pdf" || chosen.length === 0}
            onClick={() => void download("docx")}
          >
            {t("downloadWord")}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy === "pdf"}
            disabled={busy === "docx" || chosen.length === 0}
            onClick={() => void download("pdf")}
          >
            {t("downloadPdf")}
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}
