"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { canImportSeoTask } from "@/app/seo/seo-import-model";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { useSession } from "@/lib/auth/auth.client";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import {
  type seoReportVersions,
  seoTaskReportFiles,
} from "./seo-report-files-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export interface SeoReportFileProps {
  versions: ReturnType<typeof seoReportVersions>;
  model: Pick<SeoWorkspaceModel, "data" | "pending" | "execute">;
}

export function useSeoReportFiles({ model, versions }: SeoReportFileProps) {
  const t = useTranslations("App.Seo.reportFiles");
  const report = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const latest = versions.find((version) => !version.canRecover) ?? versions[0];
  const [picked, setPicked] = useState(latest.taskId);
  const version = versions.find(({ taskId }) => taskId === picked) ?? latest;
  const { data: session, isPending: loadingSession } = useSession();
  const userId = session?.user.id;
  const { taskId } = version;
  const projectId = model.data.projectId;
  const files = useQuery({
    queryKey: [
      "seo-report-files",
      session?.session.activeOrganizationId,
      userId,
      projectId,
      taskId,
      version.canRecover,
    ],
    enabled: Boolean(userId),
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { coreClient } = await import("@/lib/clients/core.browser.client");
      // Archived Tasks have a separate authorized read. Task URLs never enter the SEO workspace payload.
      const { data: task } = await coreClient
        .getTaskById(taskId)
        .catch((error: unknown) => {
          if (error instanceof CoreApiRequestError && error.status === 404)
            return coreClient.getTaskById(taskId, { archived: "true" });
          throw error;
        });
      if (task.id !== taskId) throw new Error("Unexpected report Task");
      return {
        links: seoTaskReportFiles(task),
        canImport: Boolean(
          userId &&
            !task.archivedAt &&
            canImportSeoTask(task, projectId, userId),
        ),
      };
    },
  });
  const json = files.data?.links.find(({ format }) => format === "json");
  const labelCounts = new Map<string, number>();
  const candidates = versions.map(({ taskId, kind, at }) => {
    const checkType = report.has(`analysis.${kind}`)
      ? report(`analysis.${kind}`)
      : report("timeline.checkRun");
    const date = format.dateTime(at, "dateTimeWithYear", {
      timeZone: "UTC",
      timeZoneName: "short",
    });
    const label = report("reportFiles.version", { checkType, date });
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    return { value: taskId, label };
  });
  const options = candidates.map(({ value, label }) => ({
    value,
    label:
      labelCounts.get(label) === 1
        ? label
        : report("reportFiles.taskVersion", { label, taskId: value }),
  }));
  const importReport =
    !files.isError &&
    json &&
    version.canRecover &&
    model.data.availableActions.canEdit &&
    files.data?.canImport
      ? () =>
          model.execute(
            { kind: "import_audit", body: { taskId, fileId: json.id } },
            t("imported"),
          )
      : null;
  const accessUnavailable =
    (!loadingSession && !userId) ||
    (files.error instanceof CoreApiRequestError &&
      [401, 403, 404].includes(files.error.status ?? 0));
  return {
    taskId,
    options,
    setPicked,
    files: files.data?.links,
    error: accessUnavailable
      ? ("access" as const)
      : files.isError
        ? ("failed" as const)
        : null,
    retry: accessUnavailable ? null : files.refetch,
    refreshing: files.isFetching,
    importReport,
  };
}
