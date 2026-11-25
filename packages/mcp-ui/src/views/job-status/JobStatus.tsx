import { useId, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatDateTime,
  isMessageKey,
  isUnderBase,
  type MessageKey,
  t,
} from "../../shell/text.ts";
import { PrimaryButton, QuietButton } from "../../shell/ui.tsx";
import { usePolling } from "./polling.ts";

const JobFile = z.object({
  id: z.string(),
  name: z.string().nullish(),
  fileUrl: z.string().nullish(),
});
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

/** The Job's status in plain words, and a line on what it means. */
function describeStatus(status: string): { word: string; hint?: string } {
  const word = `jobStatus.status.${status}`;
  const hint = `jobStatus.hint.${status}`;
  return {
    word: isMessageKey(word) ? t(word) : t("jobStatus.status.unknown"),
    hint: isMessageKey(hint) ? t(hint) : undefined,
  };
}

/** Only https URLs leave the view, and only through the host. */
function httpsUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

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
  const following = !finished && !missingTool;
  const { failed } = usePolling(context.refresh, following);
  // Say it updates only while it can: a host without server tools gives no refresh.
  const live = following && context.refresh !== undefined;
  const status = describeStatus(job.status);
  const agentName = job.agent?.overrideName || job.agent?.name;
  const { files, links } = outputsOf(job);

  const open = (url: string) =>
    app.openLink({ url }).catch((error: unknown) =>
      app.sendLog({
        level: "warning",
        data: `ui/open-link failed: ${String(error)}`,
      }),
    );

  const base = context.webBaseUrl;
  const webUrl =
    base &&
    `${base.replace(/\/$/, "")}/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-base font-semibold tracking-tight break-words">
          {job.name || agentName || t("jobStatus.title")}
        </h1>
        {agentName && (
          <p className="text-muted-foreground truncate text-sm">{agentName}</p>
        )}
      </header>

      <section role="status" className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          {live && (
            <span
              aria-hidden="true"
              className="bg-muted-foreground size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
            />
          )}
          {status.word}
        </p>
        {(status.hint || live) && (
          <p className="text-muted-foreground text-sm">
            {[status.hint, live && t("jobStatus.live")]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        {failed && !missingTool && (
          <p className="text-muted-foreground text-sm">
            {t("jobStatus.checkFailed")}
          </p>
        )}
      </section>

      {missingTool && (
        <section data-poll="missing-tool" className="flex flex-col gap-1">
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

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("jobStatus.started")}</dt>
        <dd>{formatDateTime(job.createdAt, context)}</dd>
        {job.completedAt && (
          <>
            <dt className="text-muted-foreground">{t("jobStatus.finished")}</dt>
            <dd>{formatDateTime(job.completedAt, context)}</dd>
          </>
        )}
      </dl>

      {job.result && <ResultText text={job.result} />}

      {files.length > 0 && (
        <Outputs title="jobStatus.files">
          {files.map((file) => (
            <Output
              key={file.id}
              label={file.name || t("jobStatus.unnamedFile")}
              url={httpsUrl(file.fileUrl)}
              onOpen={open}
            />
          ))}
        </Outputs>
      )}

      {links.length > 0 && (
        <Outputs title="jobStatus.links">
          {links.map((link) => (
            <Output
              key={link.id}
              label={link.title || link.url}
              url={httpsUrl(link.url)}
              onOpen={open}
            />
          ))}
        </Outputs>
      )}

      {webUrl && isUnderBase(webUrl, base) && (
        <div>
          <PrimaryButton onClick={() => open(webUrl)}>
            {t("jobStatus.open")}
          </PrimaryButton>
        </div>
      )}
    </article>
  );
}

function ResultText({ text }: { text: string }) {
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
      <p className="text-sm break-words whitespace-pre-wrap">{shown}</p>
      {long && (
        <div className="-mx-3">
          <QuietButton
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("jobStatus.showLess") : t("jobStatus.showAll")}
          </QuietButton>
        </div>
      )}
    </section>
  );
}

function Outputs({
  title,
  children,
}: {
  title: MessageKey;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="text-muted-foreground text-xs font-medium">
        {t(title)}
      </h2>
      <ul className="-mx-3 flex flex-col">{children}</ul>
    </section>
  );
}

/** A file or link: a button that opens it through the host when its URL is https, plain text otherwise. */
function Output({
  label,
  url,
  onOpen,
}: {
  label: string;
  url?: string;
  onOpen: (url: string) => void;
}) {
  if (!url) {
    return (
      <li className="text-muted-foreground truncate px-3 py-1.5 text-sm">
        {label}
      </li>
    );
  }
  const host = new URL(url).host;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(url)}
        className="hover:bg-accent focus-visible:outline-ring flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {label}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">{host}</span>
      </button>
    </li>
  );
}
