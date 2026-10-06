"use client";

import {
  type ChatResultDescriptor,
  type ChatResultPreview,
  SocialPostStatus,
  SokosumiJobStatus,
} from "@sokosumi/core-client";
import { getChatRoomMessageResultsResponseTransformer } from "@sokosumi/core-client/transformers";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarClock,
  Download,
  FileText,
  ImageIcon,
  ListTodo,
  LockKeyhole,
  MessageSquare,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { DecisionCard } from "@/app/personal-assistant/components/chat/decision-card";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { TaskCard } from "@/app/tasks/components/task-card";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { AgentIcon } from "@/components/agents/agent-icon";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Button } from "@/components/ui/button";
import { FileChip } from "@/components/ui/file-chip";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";

const icons = {
  task: ListTodo,
  task_schedule: CalendarClock,
  bot_schedule: CalendarClock,
  social_post: MessageSquare,
  studio_job: ImageIcon,
  job: UserRound,
  file: FileText,
  decision: MessageSquare,
};

/** Both chat timelines use the same recorded card and existing decision actions. */
export function ResultPreviewCard({
  result,
  onDecisionResolved,
}: {
  result: ChatResultPreview;
  onDecisionResolved: () => void;
}) {
  const t = useTranslations("Components.ChatResults");
  const format = useFormatter();
  const tTaskStatus = useTranslations("App.Tasks.Filters.statusOptions");
  if (result.state !== "available" || !icons[result.kind])
    return (
      <div className="bg-card-background text-muted-foreground flex max-w-xl items-center gap-2 rounded-lg border p-3 text-sm">
        <LockKeyhole aria-hidden className="size-4 shrink-0" />
        {t("unavailable")}
      </div>
    );
  if (result.decision)
    return (
      <DecisionCard
        decision={{
          ...result.decision,
          expiresAt: new Date(result.decision.expiresAt).toISOString(),
          resolvedAt: result.decision.resolvedAt
            ? new Date(result.decision.resolvedAt).toISOString()
            : null,
          createdAt: new Date(result.decision.createdAt).toISOString(),
        }}
        onResolved={onDecisionResolved}
      />
    );
  const nativeTask =
    result.kind === "task" && result.task?.createdAt
      ? {
          ...result.task,
          createdAt: new Date(result.task.createdAt).toISOString(),
          runAt: result.task.runAt
            ? new Date(result.task.runAt).toISOString()
            : null,
        }
      : null;
  const social = result.kind === "social_post" ? result.social : null;
  const postStatus = social
    ? Object.values(SocialPostStatus).find((status) => status === result.status)
    : undefined;
  const jobStatus =
    result.kind === "job"
      ? Object.values(SokosumiJobStatus).find(
          (status) => status === result.status,
        )
      : undefined;
  const Icon = icons[result.kind];
  const statusKey = `status.${result.status}`;
  return (
    <article
      className={cn(
        "w-full max-w-xl min-w-0 space-y-3",
        !nativeTask && !social && "bg-background rounded-lg border p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {result.actor ? (
            <AssigneeAvatar assignee={result.actor} size="lg" />
          ) : result.agent ? (
            <AgentIcon agent={result.agent} className="size-8" />
          ) : (
            <Icon
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
          )}
          <span className="text-muted-foreground text-xs">
            {t(`kind.${result.kind}`)}
          </span>
        </div>
        {postStatus ? (
          <SocialPostStatusBadge
            status={postStatus}
            label={t(`status.${postStatus}`)}
          />
        ) : jobStatus ? (
          <JobStatusBadge status={jobStatus} />
        ) : result.status && !nativeTask ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-2 py-0.5 text-xs">
            {t.has(statusKey) ? t(statusKey) : result.status}
          </span>
        ) : null}
      </div>
      {nativeTask ? (
        <TaskCard
          task={nativeTask}
          statusLabels={buildTaskStatusLabels((key) => tTaskStatus(key))}
        />
      ) : social ? (
        <SocialPostPreview
          provider={social.provider}
          account={social.account}
          text={result.summary ?? result.title}
          timestamp={
            social.timestamp
              ? new Date(social.timestamp)
              : new Date(result.capturedAt)
          }
          media={(result.outputs ?? [])
            .filter(
              (output) =>
                output.previewHref &&
                (output.contentType?.startsWith("image/") ||
                  output.contentType?.startsWith("video/")),
            )
            .map((output) => ({
              pathname: output.openHref,
              fileUrl: output.previewHref ?? output.openHref,
              name: output.name,
              size: output.sizeBytes ?? 0,
              mimeType: output.contentType ?? "image/png",
              kind: output.contentType?.startsWith("video/")
                ? "video"
                : output.contentType === "image/gif"
                  ? "gif"
                  : "image",
            }))}
        />
      ) : (
        <h3 className="text-foreground text-sm font-medium wrap-break-word">
          {result.title}
        </h3>
      )}
      {!social && result.summary && result.summary !== result.title ? (
        <p className="text-muted-foreground line-clamp-5 text-sm whitespace-pre-wrap wrap-break-word">
          {result.summary}
        </p>
      ) : null}
      {result.question ? (
        <p className="bg-muted text-foreground rounded-md p-2 text-sm whitespace-pre-wrap wrap-break-word">
          {result.question}
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {(
          [
            ["assignee", nativeTask ? null : result.assignee],
            ["project", nativeTask ? null : result.project],
            ["destination", result.destination],
          ] as const
        ).map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{t(label)}</dt>
              <dd className="flex items-center gap-2 wrap-break-word">
                {label === "project" && result.projectInfo ? (
                  <ProjectAvatar
                    name={result.projectInfo.name}
                    logo={result.projectInfo.logo}
                    className="size-5 rounded-sm"
                  />
                ) : null}
                {value}
              </dd>
            </div>
          ) : null,
        )}
        {result.scheduledAt ? (
          <div className="contents">
            <dt className="text-muted-foreground">{t("scheduled")}</dt>
            <dd className="wrap-break-word">
              <time dateTime={new Date(result.scheduledAt).toISOString()}>
                {format.dateTime(
                  new Date(result.scheduledAt),
                  "dateTime",
                  result.timezone ? { timeZone: result.timezone } : undefined,
                )}
              </time>
              {result.timezone ? ` · ${result.timezone}` : ""}
            </dd>
          </div>
        ) : null}
        {result.recurrence ? (
          <div className="contents">
            <dt className="text-muted-foreground">{t("recurrence")}</dt>
            <dd className="font-mono wrap-break-word">{result.recurrence}</dd>
          </div>
        ) : null}
      </dl>
      {!social && result.outputs?.length ? (
        <ul
          className={
            result.kind === "studio_job"
              ? "grid grid-cols-2 gap-3"
              : "flex flex-wrap gap-2"
          }
        >
          {result.outputs.map((output, index) => {
            const media = classifyFilePreview(
              output.previewHref ?? output.openHref,
              output.name,
              output.contentType,
            );
            const canPreview =
              output.previewHref &&
              (media.isImage ||
                media.isAudio ||
                media.isVideo ||
                media.documentKind === "pdf" ||
                media.documentKind === "text");
            return (
              <li
                key={`${output.openHref}-${index}`}
                className="min-w-0 max-w-full"
              >
                {canPreview && output.previewHref ? (
                  media.isAudio || media.isVideo ? (
                    <FileChip
                      url={output.previewHref}
                      fileName={output.name}
                      mediaType={output.contentType}
                      size={output.sizeBytes}
                    />
                  ) : (
                    <FileChipMiniPreview
                      url={output.previewHref}
                      fileName={output.name}
                      mediaType={output.contentType}
                      size={output.sizeBytes}
                      variant={result.kind === "studio_job" ? "large" : "thumb"}
                    />
                  )
                ) : (
                  <Link
                    href={output.openHref}
                    className="focus-visible:ring-ring bg-muted hover:bg-card-background-hover inline-flex max-w-full items-center gap-2 rounded-md border p-2 text-xs outline-none focus-visible:ring-2"
                  >
                    <FileText aria-hidden className="size-4 shrink-0" />
                    <span className="wrap-break-word">
                      {output.name}
                      {output.contentType ? ` · ${output.contentType}` : ""}
                      {output.sizeBytes != null
                        ? ` · ${t("bytes", { size: format.number(output.sizeBytes) })}`
                        : ""}
                    </span>
                  </Link>
                )}
                {output.downloadHref ? (
                  <a
                    href={output.downloadHref}
                    download
                    className="text-muted-foreground focus-visible:ring-ring mt-1 flex w-fit items-center gap-1 rounded-sm text-xs outline-none hover:underline focus-visible:ring-2"
                  >
                    <Download aria-hidden className="size-3.5" />
                    {t("download")}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
        <span>
          {t("recorded", {
            time: format.dateTime(new Date(result.capturedAt), "dateTime"),
          })}
        </span>
        <Link
          href={result.sourceHref}
          className="focus-visible:ring-ring text-foreground inline-flex items-center gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t("open")}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}

interface ResultPreviewsProps {
  descriptors: ChatResultDescriptor[];
  source: { roomId: string; messageId: string } | { turnId: string };
  onDecisionResolved?: () => void;
  existingDecisionIds?: string[];
}
export function ResultPreviews(props: ResultPreviewsProps) {
  return props.descriptors.length ? (
    <AuthorizedResultPreviews {...props} />
  ) : null;
}
function AuthorizedResultPreviews({
  descriptors,
  source,
  onDecisionResolved,
  existingDecisionIds,
}: ResultPreviewsProps) {
  const t = useTranslations("Components.ChatResults");
  const { data: session } = useSession();
  const path =
    "turnId" in source
      ? `/api/personal-assistant/turns/${encodeURIComponent(source.turnId)}/results`
      : `/api/chat/${encodeURIComponent(source.roomId)}/messages/${encodeURIComponent(source.messageId)}/results`;
  const query = useQuery({
    queryKey: [
      "chat-results",
      session?.user.id,
      session?.session.activeOrganizationId,
      path,
      descriptors.map((d) => d.id),
    ],
    enabled: !!session?.user.id,
    queryFn: async ({ signal }) => {
      const response = await fetch(path, {
        signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Results unavailable");
      // Both endpoints share the generated response envelope.
      const page = await getChatRoomMessageResultsResponseTransformer(
        await response.json(),
      );
      return page.data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  if (query.isError)
    return (
      <div
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-xs"
      >
        {t("loadError")}
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  if (!session?.user.id || query.isFetching || !query.data)
    return (
      <p role="status" className="text-muted-foreground text-xs">
        {t("loading")}
      </p>
    );
  const ids = new Set(descriptors.map((d) => d.id));
  return (
    <div
      className="my-2 flex min-w-0 flex-col gap-2"
      data-testid="chat-result-previews"
    >
      {query.data
        .filter(
          (result) =>
            ids.has(result.id) &&
            !(
              result.state === "available" &&
              result.decision &&
              existingDecisionIds?.includes(result.decision.id)
            ),
        )
        .map((result) => (
          <ResultPreviewCard
            key={result.id}
            result={result}
            onDecisionResolved={() => {
              void query.refetch();
              onDecisionResolved?.();
            }}
          />
        ))}
    </div>
  );
}
