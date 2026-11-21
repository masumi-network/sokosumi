"use client";

import type {
  SeoConsoleExportInput,
  SeoConsoleExportSummary,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth/auth.client";
import type { SeoOwner } from "@/lib/seo/owner";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { useSeoConsoleExports } from "./use-seo-console-exports";

type Reason = Extract<
  SeoConsoleExportInput,
  { kind: "indexing_examples" }
>["reason"];
const reasons = [
  "discovered_not_indexed",
  "crawled_not_indexed",
  "blocked_robots",
  "excluded_noindex",
  "not_found",
  "redirect",
  "alternate_canonical",
] as const satisfies readonly Reason[];

const metrics = [
  "incomingLinks",
  "internalLinks",
  "linkingSites",
  "linkingPages",
  "targetPages",
  "anchorLinks",
] as const satisfies readonly (keyof SeoConsoleExportSummary["entries"][number]["counts"])[];

export function SeoConsoleExports({
  owner,
  taskId,
}: {
  owner: SeoOwner;
  taskId: string;
}) {
  const { data: session } = useSession();
  const t = useTranslations("App.Seo.consoleExports");
  const [opened, setOpened] = useState(false);
  if (!session?.user.id) return null;
  return (
    <details onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">{t("title")}</summary>
      {opened && (
        <ConsoleExportForm
          key={JSON.stringify([
            owner,
            taskId,
            session.user.id,
            session.session.activeOrganizationId,
          ])}
          owner={owner}
          taskId={taskId}
          userId={session.user.id}
          organizationId={session.session.activeOrganizationId ?? null}
        />
      )}
    </details>
  );
}

function ConsoleExportForm({
  owner,
  taskId,
  userId,
  organizationId,
}: {
  owner: SeoOwner;
  taskId: string;
  userId: string;
  organizationId: string | null;
}) {
  const t = useTranslations("App.Seo.consoleExports");
  const id = useId();
  const [kind, setKind] =
    useState<SeoConsoleExportInput["kind"]>("linked_pages");
  const [reason, setReason] = useState<Reason>("discovered_not_indexed");
  const { reports, upload } = useSeoConsoleExports(
    owner,
    taskId,
    userId,
    organizationId,
  );
  return (
    <div className="space-y-4 py-3 text-sm">
      <p>{t("help")}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const fileInput = event.currentTarget.elements.namedItem("file");
          const file =
            fileInput instanceof HTMLInputElement
              ? fileInput.files?.[0]
              : undefined;
          if (file instanceof File)
            upload.mutate({
              file,
              input: {
                kind,
                reason,
                inspectExamples: form.has("inspect"),
                date: String(form.get("date")),
              },
            });
        }}
      >
        <SeoField id={id + "kind"} label={t("report")}>
          <SeoSelect
            id={id + "kind"}
            value={kind}
            onValueChange={(value) => setKind(value as typeof kind)}
            options={[
              "linked_pages",
              "internal_pages",
              "linking_sites",
              "anchor_text",
              "indexing_examples",
            ].map((value) => ({
              value,
              label: t(value as typeof kind),
            }))}
          />
        </SeoField>
        {kind === "indexing_examples" && (
          <SeoField id={id + "reason"} label={t("reason")}>
            <SeoSelect
              id={id + "reason"}
              value={reason}
              onValueChange={(value) => setReason(value as Reason)}
              options={reasons.map((value) => ({ value, label: t(value) }))}
            />
          </SeoField>
        )}
        {kind === "indexing_examples" &&
          [
            "discovered_not_indexed",
            "crawled_not_indexed",
            "not_found",
          ].includes(reason) && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="inspect" />
              {t("inspectExamples")}
            </label>
          )}
        <SeoField id={id + "date"} label={t("date")}>
          <Input
            name="date"
            id={id + "date"}
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            required
          />
        </SeoField>
        <SeoField id={id + "file"} label={t("file")}>
          <Input
            name="file"
            id={id + "file"}
            type="file"
            accept=".csv,text/csv"
            required
          />
        </SeoField>
        <label className="flex items-start gap-2">
          <input type="checkbox" required />
          {t("confirm")}
        </label>
        <Button type="submit" loading={upload.isPending} size="sm">
          {t("import")}
        </Button>
        {upload.isError && (
          <p role="alert">
            {t(
              upload.error.message === "409"
                ? "conflict"
                : upload.error.message === "422"
                  ? "invalid"
                  : "unavailable",
            )}
          </p>
        )}
        {upload.isSuccess && <p role="status">{t("saved")}</p>}
      </form>
      {reports.isError && <p role="alert">{t("unavailable")}</p>}
      {!reports.isError &&
        !reports.isFetching &&
        reports.data?.map((report) => (
          <section
            key={report.reason ?? report.kind}
            className="space-y-1 border-t pt-2"
          >
            <h4 className="font-medium">{t(report.reason ?? report.kind)}</h4>
            <p>
              {t("sample", { date: report.date, count: report.sampleSize })}
            </p>
            {report.previousDate && (
              <p>{t("comparison", { date: report.previousDate })}</p>
            )}
            {report.newInSample !== null &&
              report.absentFromSample !== null && (
                <p>
                  {t("movement", {
                    added: report.newInSample,
                    absent: report.absentFromSample,
                  })}
                </p>
              )}
            {report.entries.length < report.sampleSize && (
              <p>{t("preview", { count: report.entries.length })}</p>
            )}
            <ul className="space-y-2">
              {report.entries.map((entry) => (
                <li key={entry.key}>
                  <p className="break-all font-medium">
                    {entry.key || t("emptyAnchor")}
                  </p>
                  {entry.auditedUrl && <p>{t("audited")}</p>}
                  {metrics.map((metric) => {
                    const count = entry.counts[metric];
                    if (count === undefined) return null;
                    const previous = entry.previousCounts?.[metric];
                    return (
                      <p key={metric}>
                        {t(metric, { count })}{" "}
                        {previous !== undefined &&
                          t("previousValue", { count: previous })}
                      </p>
                    );
                  })}
                  {report.previousDate && (
                    <p>{t(entry.previousCounts ? "repeated" : "newSample")}</p>
                  )}
                  {entry.inspection && (
                    <p>
                      {entry.inspection.status === "observed"
                        ? t("inspection", {
                            date: entry.inspection.checkedAt,
                            verdict:
                              entry.inspection.verdict ?? "VERDICT_UNSPECIFIED",
                          })
                        : t("inspectionUnavailable", {
                            date: entry.inspection.checkedAt,
                          })}
                    </p>
                  )}
                  {report.reason &&
                    (entry.inspection?.verdict === "PASS" ? (
                      <p>{t("indexPass")}</p>
                    ) : (
                      <p>{t(`action_${report.reason}`)}</p>
                    ))}
                  {report.kind === "linked_pages" &&
                    entry.previousCounts?.incomingLinks !== undefined &&
                    entry.counts.incomingLinks !== undefined &&
                    entry.counts.incomingLinks <
                      entry.previousCounts.incomingLinks && (
                      <p>{t("checkLinks")}</p>
                    )}
                  {report.kind === "internal_pages" &&
                    entry.previousCounts?.internalLinks !== undefined &&
                    entry.counts.internalLinks !== undefined &&
                    entry.counts.internalLinks <
                      entry.previousCounts.internalLinks && (
                      <p>{t("checkInternal")}</p>
                    )}
                  {report.kind === "anchor_text" && entry.key === "" && (
                    <p>{t("checkAnchor")}</p>
                  )}
                  {report.kind === "linking_sites" &&
                    report.previousDate &&
                    !entry.previousCounts && <p>{t("checkDomain")}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
