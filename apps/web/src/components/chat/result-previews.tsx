"use client";

import {
  type ChatResultDescriptor,
  type ChatResultPreview,
  SokosumiJobStatus,
} from "@sokosumi/core-client";
import { getMySokoBotTurnResultsResponseTransformer } from "@sokosumi/core-client/transformers";
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
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { DecisionCard } from "@/app/personal-assistant/components/chat/decision-card";
import {
  SokoBotTargetContext,
  useSokoBotTargetId,
} from "@/app/personal-assistant/components/soko-bot-target";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
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
import { withBotIdParam } from "@/lib/soko-bot/bot-id-param";
import { SOKO_BOT_ROUTE, sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { ProjectSelectionMessage } from "./project-selection-message";
import { loadRoomMessageResults } from "./room-message-results";
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

/**
 * Core points bot cards (such as a schedule) at the caller's own console. For
 * a shared bot that is the wrong console, so send them to the bot's own.
 */
export function cardHref(sourceHref: string, botId?: string | null): string {
  const rest = sourceHref.slice(SOKO_BOT_ROUTE.length);
  if (
    !botId ||
    !sourceHref.startsWith(SOKO_BOT_ROUTE) ||
    !/^([?#]|$)/.test(rest)
  )
    return sourceHref;
  return `${sokoBotConsoleRoute(botId)}${rest}`;
}

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
  const sourceLink = useRef<HTMLAnchorElement>(null);
  const botId = useSokoBotTargetId();
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
  if (social)
    return (
      <SocialPostPreview
        className="w-full min-w-0 max-w-xl"
        provider={social.provider}
        account={social.account}
        text={result.summary ?? result.title}
        timestamp={social.timestamp ? new Date(social.timestamp) : null}
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
    );
  const jobStatus =
    result.kind === "job"
      ? Object.values(SokosumiJobStatus).find(
          (status) => status === result.status,
        )
      : undefined;
  const Icon = icons[result.kind];
  const statusKey = `status.${result.status}`;
  const jobHintKey = `jobHint.${jobStatus}`;
  const jobHint = jobStatus && t.has(jobHintKey) ? t(jobHintKey) : null;
  function openSource(event: ReactMouseEvent<HTMLElement>) {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1))
      return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !event.currentTarget.contains(target) ||
      target.closest(
        'a,button,input,select,textarea,audio,video,[role="button"],[role="link"],[contenteditable="true"]',
      )
    )
      return;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      event.currentTarget.contains(selection.anchorNode)
    )
      return;
    sourceLink.current?.dispatchEvent(
      new MouseEvent(event.type, {
        bubbles: true,
        cancelable: true,
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }),
    );
  }
  return (
    <article
      onClick={openSource}
      onAuxClick={openSource}
      className={cn(
        "relative isolate w-full min-w-0 cursor-pointer rounded-lg",
        nativeTask ? "max-w-sm" : "max-w-xl",
        !nativeTask && "bg-background rounded-lg border p-4",
      )}
    >
      <Link
        ref={sourceLink}
        href={cardHref(result.sourceHref, botId)}
        aria-label={t("openLabel", { title: result.title })}
        className="focus-visible:ring-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
        data-testid="result-preview-source"
      />
      <div className="relative z-10 space-y-3">
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
              {jobStatus && result.agent
                ? result.agent.name
                : t(`kind.${result.kind}`)}
            </span>
          </div>
          {jobStatus ? (
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
        ) : (
          <h3 className="text-foreground text-sm font-medium wrap-break-word">
            {result.title}
          </h3>
        )}
        {jobHint ? (
          <p className="text-muted-foreground text-sm">{jobHint}</p>
        ) : null}
        {!nativeTask && result.summary && result.summary !== result.title ? (
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
                ["assignee", nativeTask || jobStatus ? null : result.assignee],
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
            {result.details?.map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="contents">
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="min-w-0 wrap-break-word">
                  <DetailValue value={detail.value} />
                </dd>
              </div>
            ))}
            {result.scheduledAt ? (
              <div className="contents">
                <dt className="text-muted-foreground">{t("scheduled")}</dt>
                <dd className="wrap-break-word">
                  <time dateTime={new Date(result.scheduledAt).toISOString()}>
                    {format.dateTime(
                      new Date(result.scheduledAt),
                      "dateTime",
                      result.timezone
                        ? { timeZone: result.timezone }
                        : undefined,
                    )}
                  </time>
                  {result.timezone ? ` · ${result.timezone}` : ""}
                </dd>
              </div>
            ) : null}
            {result.recurrence ? (
              <div className="contents">
                <dt className="text-muted-foreground">{t("recurrence")}</dt>
                <dd className="font-mono wrap-break-word">
                  {result.recurrence}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        {result.outputs?.length ? (
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
                        variant={
                          result.kind === "studio_job" ? "large" : "thumb"
                        }
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
          {jobStatus ? null : (
            <span>
              {t("recorded", {
                time: format.dateTime(new Date(result.capturedAt), "dateTime"),
              })}
            </span>
          )}
          <span
            aria-hidden
            className="text-foreground ml-auto inline-flex items-center gap-1"
          >
            {jobStatus ? t("openJob") : t("open")}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </span>
        </div>
      </div>
    </article>
  );
}

/** An http(s) value opens in a new tab; anything else stays text. */
function DetailValue({ value }: { value: string }) {
  let url: URL | null = null;
  try {
    url = /^https?:\/\//i.test(value) ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url) return value;
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2"
    >
      {`${url.host}${url.pathname === "/" ? "" : url.pathname}`}
    </a>
  );
}

interface ResultPreviewsProps {
  descriptors: ChatResultDescriptor[];
  source:
    | { roomId: string; messageId: string }
    | { turnId: string; botId?: string };
  onDecisionResolved?: () => void;
  existingDecisionIds?: string[];
  renderFooter?: (results: ChatResultPreview[]) => ReactNode;
  /** A shared bot's id, so its decision cards resolve on that bot. */
  sokoBotId?: string | null;
}
export function ResultPreviews(props: ResultPreviewsProps) {
  if (!props.descriptors.length) return props.renderFooter?.([]) ?? null;
  const previews = <AuthorizedResultPreviews {...props} />;
  return props.sokoBotId ? (
    <SokoBotTargetContext.Provider value={props.sokoBotId}>
      {previews}
    </SokoBotTargetContext.Provider>
  ) : (
    previews
  );
}
function AuthorizedResultPreviews({
  descriptors,
  source: givenSource,
  onDecisionResolved,
  existingDecisionIds,
  renderFooter,
}: ResultPreviewsProps) {
  const t = useTranslations("Components.ChatResults");
  const { data: session } = useSession();
  const viewerId = session?.user.id;
  // A shared bot's console reads, and continues, that bot's turns.
  const botId = useSokoBotTargetId();
  const source =
    "turnId" in givenSource && botId ? { ...givenSource, botId } : givenSource;
  const query = useQuery({
    queryKey: [
      "chat-results",
      viewerId,
      session?.session.activeOrganizationId,
      source,
      descriptors.map((d) => d.id),
    ],
    enabled: !!viewerId,
    queryFn: async ({ signal }) => {
      if (!("turnId" in source))
        return loadRoomMessageResults(source.roomId, source.messageId);
      const response = await fetch(
        withBotIdParam(
          `/api/personal-assistant/turns/${encodeURIComponent(source.turnId)}/results`,
          "botId" in source ? source.botId : null,
        ),
        { signal, credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("Results unavailable");
      const page = await getMySokoBotTurnResultsResponseTransformer(
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
