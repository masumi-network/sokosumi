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
  FolderKanban,
  ImageIcon,
  ListTodo,
  LockKeyhole,
  MessageSquare,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { DecisionCard } from "@/app/personal-assistant/components/chat/decision-card";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { TaskCard } from "@/app/tasks/components/task-card";
import { TaskProjectSelect } from "@/app/tasks/components/task-project-select";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { AgentIcon } from "@/components/agents/agent-icon";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Button } from "@/components/ui/button";
import { FileChip } from "@/components/ui/file-chip";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { ProjectSelectionMessage } from "./project-selection-message";
import { selectChatProjectAction } from "./select-project-action";

const icons = {
  task: ListTodo,
  task_schedule: CalendarClock,
  bot_schedule: CalendarClock,
  social_post: MessageSquare,
  studio_job: ImageIcon,
  job: UserRound,
  file: FileText,
  decision: MessageSquare,
  project_selection: FolderKanban,
};

/** Both chat timelines use the same recorded card and existing decision actions. */
export function ResultPreviewCard({
  result,
  onDecisionResolved,
  source,
}: {
  source?: ResultPreviewsProps["source"];
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
  if (result.kind === "project_selection")
    return <ChatProjectSelection result={result} source={source} />;
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
        "w-full min-w-0 space-y-3",
        nativeTask ? "max-w-sm" : "max-w-xl",
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
      {!nativeTask &&
      !social &&
      result.summary &&
      result.summary !== result.title ? (
        <p className="text-muted-foreground line-clamp-5 text-sm whitespace-pre-wrap wrap-break-word">
          {result.summary}
        </p>
      ) : null}
      {result.question ? (
        <p className="bg-muted text-foreground rounded-md p-2 text-sm whitespace-pre-wrap wrap-break-word">
          {result.question}
        </p>
      ) : null}
      {!nativeTask && (
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
      )}
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
                className={cn(
                  "min-w-0 max-w-full",
                  (media.isAudio || media.isVideo) && "w-full",
                )}
              >
                {canPreview && output.previewHref ? (
                  media.isAudio || media.isVideo ? (
                    <FileChip
                      className="max-w-full"
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
                    aria-label={t("downloadLabel", { name: output.name })}
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
          aria-label={t("openLabel", { title: result.title })}
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
  renderFooter?: (results: ChatResultPreview[]) => ReactNode;
}
export function ResultPreviews(props: ResultPreviewsProps) {
  return props.descriptors.length ? (
    <AuthorizedResultPreviews {...props} />
  ) : (
    (props.renderFooter?.([]) ?? null)
  );
}
function AuthorizedResultPreviews({
  descriptors,
  source,
  onDecisionResolved,
  existingDecisionIds,
  renderFooter,
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
      <>
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-2 text-xs"
        >
          {t("loadError")}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
        {renderFooter?.([])}
      </>
    );
  if (!session?.user.id || query.isFetching || !query.data)
    return (
      <>
        <p role="status" className="text-muted-foreground text-xs">
          {t("loading")}
        </p>
        {renderFooter?.([])}
      </>
    );
  const ids = new Set(descriptors.map((d) => d.id));
  const results = query.data.filter((result) => ids.has(result.id));
  return (
    <>
      <div
        className="my-2 flex min-w-0 flex-col gap-2"
        data-testid="chat-result-previews"
      >
        {results
          .filter(
            (result) =>
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
              source={source}
              onDecisionResolved={() => {
                void query.refetch();
                onDecisionResolved?.();
              }}
            />
          ))}
      </div>
      {renderFooter?.(results)}
    </>
  );
}

function ChatProjectSelection({
  result,
  source,
}: {
  result: Extract<ChatResultPreview, { state: "available" }>;
  source?: ResultPreviewsProps["source"];
}) {
  const t = useTranslations("Components.ChatResults.selection");
  const router = useRouter();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const options = result.projectOptions ?? [];
  async function handleSelect(projectId: string | null) {
    if (!projectId || !source || sending.current || selected) return;
    sending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const response = await selectChatProjectAction({
        source,
        previewId: result.id,
        projectId,
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setSelected(projectId);
      if ("turnId" in source) router.refresh();
    } catch {
      setFailed(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const selectedProject = options.find((project) => project.id === selected);
  return (
    <section
      className="bg-background w-full max-w-sm space-y-2 rounded-lg border p-3"
      aria-label={t("label")}
    >
      {selectedProject ? (
        <div
          role="status"
          aria-label={t("selected", { name: selectedProject.name })}
        >
          <ProjectSelectionMessage project={selectedProject} />
        </div>
      ) : options.length && source ? (
        <fieldset disabled={busy} className="min-w-0">
          <TaskProjectSelect
            projectOptions={options}
            value={undefined}
            allowNone={false}
            projectLabel={t("label")}
            placeholder={t("label")}
            noneLabel={t("label")}
            searchPlaceholder={t("search")}
            emptyResults={t("empty")}
            onChange={(id) => void handleSelect(id)}
          />
        </fieldset>
      ) : (
        <p role="status" className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      )}
      {busy ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("sending")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-semantic-destructive text-xs">
          {t("failed")}
        </p>
      ) : null}
    </section>
  );
}
