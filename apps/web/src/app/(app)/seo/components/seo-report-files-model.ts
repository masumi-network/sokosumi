import type { ProjectSeoWorkspace, Task } from "@sokosumi/core-client";
import {
  isOwnedTaskFileUrl,
  isVercelBlobPublicHost,
  seoReportFileFormat,
} from "@sokosumi/utils";

interface SeoReportVersion {
  taskId: string;
  at: Date;
  kind: string;
  canRecover: boolean;
}

/** The observation dates the report. A dispatched Task can have files before its import succeeds. */
export function seoReportVersions(
  workspace: Pick<ProjectSeoWorkspace, "observations" | "analyses">,
  { from, to }: { from: string | null; to: string | null },
) {
  const versions = new Map<string, SeoReportVersion>();
  for (const analysis of workspace.analyses) {
    if (analysis.taskId)
      versions.set(analysis.taskId, {
        taskId: analysis.taskId,
        at: new Date(analysis.createdAt),
        kind: analysis.kind,
        canRecover: analysis.status !== "completed",
      });
  }
  for (const observation of workspace.observations) {
    if (observation.sourceTaskId)
      versions.set(observation.sourceTaskId, {
        taskId: observation.sourceTaskId,
        at: new Date(observation.observedAt),
        kind: observation.kind,
        canRecover: false,
      });
  }
  return [...versions.values()]
    .filter(({ at }) => {
      const day = at.toISOString().slice(0, 10);
      return (!from || day >= from) && (!to || day <= to);
    })
    .sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() || a.taskId.localeCompare(b.taskId),
    );
}

type Format = NonNullable<ReturnType<typeof seoReportFileFormat>>;
interface ReportFile {
  id: string;
  format: Format;
  url: string;
}

export function seoTaskReportFiles(
  task: Pick<Task, "id" | "assigneeId" | "files">,
) {
  const files = new Map<Format, ReportFile>();
  for (const file of task.files.toSorted(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )) {
    if (
      file.taskId !== task.id ||
      file.status !== "READY" ||
      file.uploader?.type !== "coworker" ||
      file.uploader.id !== task.assigneeId ||
      !file.fileUrl ||
      !isOwnedTaskFileUrl(file.fileUrl, task.id)
    )
      continue;
    const url = new URL(file.fileUrl);
    const format = seoReportFileFormat(task.id, file.name, file.mimeType);
    if (
      format &&
      !files.has(format) &&
      url.protocol === "https:" &&
      isVercelBlobPublicHost(url.hostname)
    )
      files.set(format, { id: file.id, format, url: file.fileUrl });
  }
  return (["pdf", "markdown", "json"] as const).flatMap(
    (format) => files.get(format) ?? [],
  );
}
