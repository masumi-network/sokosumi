import {
  Ban,
  Check,
  CirclePlay,
  CircleX,
  Clock,
  File,
  Handshake,
  Link2,
  LoaderCircle,
  type LucideIcon,
  MessageSquareWarning,
  PackageX,
  RotateCcw,
  Scale,
} from "lucide-react";
import { useId, useState } from "react";
import { z } from "zod";
import { Markdown } from "../../shell/Markdown.tsx";
import type { ViewContext } from "../../shell/Shell.tsx";
import { type MarkerSpec, StatusBadge } from "../../shell/status.tsx";
import {
  formatDateTime,
  isMessageKey,
  isUnderBase,
  type MessageKey,
  t,
} from "../../shell/text.ts";
import { Button, PrimaryButton } from "../../shell/ui.tsx";
import { InputRequest } from "./InputRequest.tsx";
import { usePolling } from "./polling.ts";

const JobFile = z.object({ id: z.string(), name: z.string().nullish() });
const JobLink = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullish(),
});

/** The fields of a `jobs_get` Job the view reads; the rest is ignored. */
const Job = z.object({
  id: z.string(),
  name: z.string().nullish(),
  status: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullish(),
  agentId: z.string(),
  agent: z
    .object({ name: z.string(), overrideName: z.string().nullish() })
    .nullish(),
  result: z.string().nullish(),
  events: z
    .array(
      z.object({
        id: z.string().optional(),
        status: z.string().optional(),
        createdAt: z.string().optional(),
        input: z.unknown(),
        blobs: z.array(JobFile).nullish(),
        links: z.array(JobLink).nullish(),
      }),
    )
    .nullish(),
});
type Job = z.infer<typeof Job>;

/** `jobs_get`'s result, which `jobs_show` returns unchanged. */
export const JobResult = z.object({ data: Job });
export type JobResult = z.infer<typeof JobResult>;

/** Statuses after which a Job does not change on its own (packages/utils sokosumi-job-status.ts). */
const FINISHED = new Set([
  "completed",
  "failed",
  "payment_failed",
  "refund_resolved",
  "dispute_resolved",
]);

/** Web's job-status-styles.ts table, on the shared marker. */
const MARKERS: Record<string, MarkerSpec> = {
  payment_pending: { icon: Handshake, hue: "staged", weight: "outline" },
  started: { icon: CirclePlay, hue: "staged" },
  processing: { icon: LoaderCircle, hue: "active", spin: true },
  refund_pending: { icon: RotateCcw, hue: "active", weight: "outline" },
  result_pending: { icon: PackageX, hue: "fault" },
  dispute_pending: { icon: Scale, hue: "fault", weight: "outline" },
  input_required: { icon: MessageSquareWarning, hue: "blocked" },
  completed: { icon: Check, hue: "resolved" },
  failed: { icon: CircleX, hue: "fault", weight: "solid" },
  payment_failed: { icon: Ban, hue: "fault", weight: "solid" },
  refund_resolved: { icon: RotateCcw, hue: "dormant", weight: "outline" },
  dispute_resolved: { icon: Scale, hue: "dormant", weight: "outline" },
};
const UNKNOWN: MarkerSpec = { icon: Clock, hue: "dormant", weight: "outline" };

/** The Job's status in plain words, and a line on what it means. */
function describeStatus(status: string): { word: string; hint?: string } {
  const word = `jobStatus.status.${status}`;
  const hint = `jobStatus.hint.${status}`;
  return {
    word: isMessageKey(word) ? t(word) : t("jobStatus.status.unknown"),
    hint: isMessageKey(hint) ? t(hint) : undefined,
  };
}

/**
 * Core's answer when the Job can no longer be read here: moved, deleted or
 * access lost. A 429 is a pause, not an answer.
 */
const isGone = (status?: number) =>
  status !== undefined && status >= 400 && status < 500 && status !== 429;

/** Files and links from every event, newest event first, each once. */
function outputsOf(job: Job) {
  const files = new Map<string, z.infer<typeof JobFile>>();
  const links = new Map<string, z.infer<typeof JobLink>>();
  for (const event of job.events ?? []) {
    for (const file of event.blobs ?? []) files.set(file.id, file);
    for (const link of event.links ?? []) links.set(link.id, link);
  }
  return { files: [...files.values()], links: [...links.values()] };
}

/**
 * The input request Core answers next: the oldest unanswered
 * `AWAITING_INPUT` event, as `jobs_input_request` picks it.
 */
function pendingRequestId(job: Job): string | undefined {
  return (job.events ?? [])
    .filter(({ status, input }) => status === "AWAITING_INPUT" && input == null)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0]
    ?.id;
}

/** Longer results start folded, so the view stays a summary in the chat. */
const FOLDED_RESULT_CHARS = 1200;

export function JobStatus({
  data,
  context,
}: {
  data: JobResult;
  context: ViewContext;
}) {
  const job = data.data;
  const { app, missingTool } = context;
  const finished = FINISHED.has(job.status);
  const gone = isGone(context.refreshStatus);
  // Polling holds while an answer to the Job's question is in flight (SOKD-423).
  const [answering, setAnswering] = useState(false);
  const [answeredId, setAnsweredId] = useState<string>();
  const pendingId = pendingRequestId(job);
  // Core may still say input_required after the answer, until the agent moves on.
  const answered =
    answeredId !== undefined && (pendingId ?? answeredId) === answeredId;
  const asking = job.status === "input_required" && !gone;
  const following = !finished && !missingTool && !gone && !answering;
  const { failed } = usePolling(context.refresh, following);
  // Say it updates only while it can: a host without server tools gives no refresh.
  const live = following && context.refresh !== undefined;
  const status = describeStatus(job.status);
  const spec = MARKERS[job.status] ?? UNKNOWN;
  // The running glyph spins only while the view follows the Job.
  const marker = { ...spec, spin: spec.spin && live };
  const agentName = job.agent?.overrideName || job.agent?.name;
  const { files, links } = outputsOf(job);

  // The only link the view opens (ADR 0083): the Job in Web, where the
  // person opens its files and links.
  const base = context.webBaseUrl;
  const jobUrl =
    base &&
    `${base.replace(/\/$/, "")}/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`;
  const webUrl = jobUrl && isUnderBase(jobUrl, base) ? jobUrl : undefined;
  const openJob = (url: string) =>
    app.openLink({ url }).catch((error: unknown) =>
      app.sendLog({
        level: "warning",
        data: `ui/open-link failed: ${String(error)}`,
      }),
    );

  return (
    <article className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl leading-tight font-semibold tracking-tight break-words">
          {job.name || agentName || t("jobStatus.title")}
        </h1>
        {agentName && (
          <p className="text-muted-foreground truncate text-sm">{agentName}</p>
        )}
      </header>

      <section role="status" className="flex flex-col items-start gap-2">
        <StatusBadge spec={marker} label={status.word} />
        {(status.hint || live) && (
          <p className="text-muted-foreground text-sm">
            {[status.hint, live && t("jobStatus.live")]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        {failed && following && (
          <p className="text-muted-foreground text-sm">
            {t("jobStatus.checkFailed")}
          </p>
        )}
      </section>

      {missingTool && (
        <section data-step="missing-tool" className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">
            {t("jobStatus.missingToolset.title")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("jobStatus.missingToolset.body")}
          </p>
          <code className="text-sm break-words">
            {t("jobStatus.missingToolset.example")}
          </code>
        </section>
      )}

      {gone && (
        <section data-step="gone" className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{t("jobStatus.gone.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("jobStatus.gone.body")}
          </p>
        </section>
      )}

      <dl className="divide-border flex flex-col divide-y text-sm">
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">{t("jobStatus.started")}</dt>
          <dd className="tabular-nums">
            {formatDateTime(job.createdAt, context)}
          </dd>
        </div>
        {job.completedAt && (
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{t("jobStatus.finished")}</dt>
            <dd className="tabular-nums">
              {formatDateTime(job.completedAt, context)}
            </dd>
          </div>
        )}
      </dl>

      {asking &&
        (answered ? (
          <p data-step="input-sent" className="text-sm">
            {t("jobStatus.input.sent")}
          </p>
        ) : (
          <InputRequest
            // A new request (another event), or the call's arguments
            // arriving after the result, loads afresh.
            key={`${pendingId ?? "request"}${context.input ? "" : ":no-input"}`}
            jobId={job.id}
            context={context}
            onPause={setAnswering}
            onSent={(eventId) => {
              setAnsweredId(eventId);
              void context.refresh?.();
            }}
            onUpload={webUrl ? () => openJob(webUrl) : undefined}
          />
        ))}

      {job.result && (
        <ResultText text={job.result} webBaseUrl={base} onOpenLink={openJob} />
      )}

      {files.length > 0 && (
        <Outputs
          title="jobStatus.files"
          icon={File}
          names={files.map(({ name }) => name || t("jobStatus.unnamedFile"))}
        />
      )}
      {links.length > 0 && (
        <Outputs
          title="jobStatus.links"
          icon={Link2}
          names={links.map(({ title, url }) => title || url)}
        />
      )}
      {webUrl && (files.length > 0 || links.length > 0) && (
        <p className="text-muted-foreground -mt-3 text-sm">
          {t("jobStatus.openOutputs")}
        </p>
      )}

      {webUrl && (
        <div>
          <PrimaryButton onClick={() => openJob(webUrl)}>
            {t("jobStatus.open")}
          </PrimaryButton>
        </div>
      )}
    </article>
  );
}

/** The result as Markdown, as on Web's Job page, in a card. */
function ResultText({
  text,
  webBaseUrl,
  onOpenLink,
}: {
  text: string;
  webBaseUrl?: string;
  onOpenLink: (url: string) => void;
}) {
  const headingId = useId();
  // Code points, so a fold never splits an emoji.
  const chars = Array.from(text);
  const long = chars.length > FOLDED_RESULT_CHARS;
  const [expanded, setExpanded] = useState(false);
  const shown =
    long && !expanded
      ? `${chars.slice(0, FOLDED_RESULT_CHARS).join("").trimEnd()}…`
      : text;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-muted-foreground text-xs font-medium">
        {t("jobStatus.result")}
      </h2>
      <div className="bg-card-background border-border rounded-lg border p-3">
        <Markdown
          text={shown}
          webBaseUrl={webBaseUrl}
          onOpenLink={onOpenLink}
        />
      </div>
      {long && (
        <div className="-mx-3">
          <Button
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("jobStatus.showLess") : t("jobStatus.showAll")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** A Job's files or links as Web's chips, by name only: they open in Sokosumi (ADR 0083). */
function Outputs({
  title,
  icon: Icon,
  names,
}: {
  title: MessageKey;
  icon: LucideIcon;
  names: string[];
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-muted-foreground text-xs font-medium">
        {t(title)}
      </h2>
      <ul className="flex flex-wrap gap-2 text-sm">
        {names.map((name, index) => (
          // Names may repeat, and the list never reorders: the index keys it.
          <li
            key={index}
            className="bg-background border-border flex max-w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5"
          >
            <Icon
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0"
            />
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
