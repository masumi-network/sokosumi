"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import {
  type seoReportVersions,
  seoTaskReportFiles,
} from "./seo-report-files-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export interface SeoReportFileProps {
  versions: ReturnType<typeof seoReportVersions>;
  model: Pick<SeoWorkspaceModel, "data" | "pending" | "execute">;
}

function needsPropertyEvidence(
  report: NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number],
) {
  return (
    !report.propertyTotals ||
    !report.pageDiscovery?.topClickedPages ||
    report.pageDiscovery.comparisonIncomplete ||
    report.pageDiscovery.pages.some((page) => page.queryUnavailable)
  );
}

export function useSeoReportFiles(
  { model, versions }: SeoReportFileProps,
  loadFiles: boolean,
) {
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
  const queryClient = useQueryClient();
  const organizationId = session?.session.activeOrganizationId;
  const owner = seoWorkspaceOwner(model.data);
  const canRecoverSearch = Boolean(
    userId && model.data.auditSearchConsoleRetryTaskIds?.includes(taskId),
  );
  const evidence = model.data.auditSearchConsole?.find(
    (entry) => entry.taskId === taskId,
  );
  const canLoadProperty = Boolean(
    userId &&
      evidence &&
      !evidence.propertyDataExpired &&
      needsPropertyEvidence(evidence),
  );
  const recovery = useMutation({
    mutationFn: async ({
      id,
      property,
    }: {
      id: string;
      property?: boolean;
    }) => {
      if (!(property ? canLoadProperty : canRecoverSearch) || id !== taskId)
        throw new Error("Audit recovery unavailable");
      const response = await fetch(`${seoOwnerApiPath(owner)}/statistics`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          ...seoViewerHeaders(userId, organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auditTaskId: id,
          ...(property && {
            includePropertyTotals: true,
            includePageDiscovery: true,
          }),
        }),
      });
      if (!response.ok) throw new Error("Audit recovery failed");
      const workspace: ProjectSeoWorkspace = await response.json();
      const saved = workspace.auditSearchConsole?.find(
        (entry) => entry.taskId === id,
      );
      if (!saved || (property && !saved.pageDiscovery && !saved.propertyTotals))
        throw new Error("Audit evidence unavailable");
      // The response describes the original audit pages. Keep each cached view's current filters and other runs.
      queryClient.setQueriesData<ProjectSeoWorkspace>(
        {
          queryKey: [
            "seo-workspace",
            organizationId,
            userId,
            owner.kind,
            owner.id,
          ],
        },
        (cached) => {
          if (property) {
            if (
              !cached?.auditSearchConsole?.some((entry) => entry.taskId === id)
            )
              return cached;
            return {
              ...cached,
              auditSearchConsole: cached.auditSearchConsole.map((entry) =>
                entry.taskId === id
                  ? {
                      ...entry,
                      propertyTotals:
                        saved.propertyTotals ?? entry.propertyTotals,
                      pageDiscovery: saved.pageDiscovery ?? entry.pageDiscovery,
                    }
                  : entry,
              ),
            };
          }
          if (!cached?.auditSearchConsoleRetryTaskIds?.includes(id))
            return cached;
          return {
            ...cached,
            auditSearchConsole: [
              ...(cached.auditSearchConsole ?? []).filter(
                (entry) => entry.taskId !== id,
              ),
              saved,
            ],
            auditSearchConsoleRetryTaskIds:
              workspace.auditSearchConsoleRetryTaskIds?.includes(id)
                ? cached.auditSearchConsoleRetryTaskIds
                : cached.auditSearchConsoleRetryTaskIds.filter(
                    (eligible) => eligible !== id,
                  ),
          };
        },
      );
      if (property && needsPropertyEvidence(saved))
        throw new Error("Property evidence incomplete");
    },
  });
  const strategy = model.data.strategy;
  const speedFileId = model.data.observations.find(
    (row) => row.sourceTaskId === taskId && row.kind === "audit_full",
  )?.pageSpeedRecoveryFileId;
  const marketFileId =
    strategy?.marketRecoveryFileId &&
    model.data.observations.some(
      (obs) =>
        obs.id === strategy.observationId &&
        obs.sourceTaskId === taskId &&
        obs.kind === "audit_full",
    )
      ? strategy.marketRecoveryFileId
      : undefined;
  const files = useQuery({
    queryKey: [
      "seo-report-files",
      session?.session.activeOrganizationId,
      userId,
      projectId,
      taskId,
      version.canRecover,
      marketFileId,
      speedFileId,
    ],
    enabled: loadFiles && Boolean(userId),
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
        speedFile:
          speedFileId &&
          seoTaskReportFiles({
            ...task,
            files: task.files.filter((f) => f.id === speedFileId),
          }).find((f) => f.format === "json"),
        marketFile:
          marketFileId &&
          seoTaskReportFiles({
            ...task,
            files: task.files.filter((file) => file.id === marketFileId),
          }).find((file) => file.format === "json"),
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
  const marketFile = files.data?.marketFile;
  const recoverMarkets =
    !files.isError &&
    !version.canRecover &&
    model.data.availableActions.canEdit &&
    files.data?.canImport &&
    marketFile
      ? () =>
          model.execute(
            {
              kind: "import_audit",
              body: { taskId, fileId: marketFile.id, recoverMarkets: true },
            },
            t("marketsChecked"),
          )
      : null;
  const speedFile = files.data?.speedFile;
  const recoverPageSpeed =
    !files.isError &&
    !version.canRecover &&
    model.data.availableActions.canEdit &&
    files.data?.canImport &&
    speedFile
      ? () =>
          model.execute(
            {
              kind: "import_audit",
              body: { taskId, fileId: speedFile.id, recoverPageSpeed: true },
            },
            t("speedChecked"),
          )
      : null;
  const accessUnavailable =
    (!loadingSession && !userId) ||
    (files.error instanceof CoreApiRequestError &&
      [401, 403, 404].includes(files.error.status ?? 0));
  return {
    taskId,
    siteEvidence:
      model.data.auditSiteEvidence?.find((entry) => entry?.taskId === taskId) ??
      (model.data.siteEvidence?.taskId === taskId
        ? model.data.siteEvidence
        : null),
    evidence,
    loadProperty: canLoadProperty
      ? () => recovery.mutate({ id: taskId, property: true })
      : null,
    fullAudit: version.kind === "audit_full",
    recoverSearch: canRecoverSearch
      ? () => recovery.mutate({ id: taskId })
      : null,
    recovering: recovery.isPending && recovery.variables?.id === taskId,
    recoveryError:
      recovery.isError && recovery.variables?.id === taskId
        ? recovery.variables.property
          ? ("propertyTotalsFailed" as const)
          : ("recoverSearchFailed" as const)
        : null,
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
    recoverMarkets,
    recoverPageSpeed,
  };
}
