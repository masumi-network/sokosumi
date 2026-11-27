import type { ScenarioCheck } from "@sokosumi/soko-bot";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "../eval-lanes.service";
import type { JourneyWorld } from "./journey-world";
import type { FixtureInvestor, JourneyOutcome, OwnerJourney } from "./journeys";

const ZONE = "Europe/Berlin";
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The weekdays (0 = Sunday) a five-field cron's day-of-week field allows. */
export function cronDays(cron: string): number[] {
  const field = cron.trim().split(/\s+/)[4] ?? "*";
  if (field === "*" || field === "?") return [0, 1, 2, 3, 4, 5, 6];
  const day = (value: string) => {
    const named = DOW_NAMES.indexOf(value.toLowerCase().slice(0, 3));
    return named >= 0 ? named : Number(value) % 7;
  };
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const [range = "", step = "1"] = part.split("/");
    const [from = "", to] = range.split("-");
    const start = range === "*" ? 0 : day(from);
    const end = range === "*" ? 6 : to === undefined ? start : day(to);
    const last = end < start ? end + 7 : end;
    for (let value = start; value <= last; value += Number(step))
      days.add(value % 7);
  }
  return [...days].sort();
}

function cronTime(cron: string): { minute: number; hour: number } | null {
  const [minute, hour] = cron.trim().split(/\s+/);
  return /^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "")
    ? { minute: Number(minute), hour: Number(hour) }
    : null;
}

function matchesAll(text: string, patterns: readonly string[] = []) {
  const missing = patterns.filter(
    (pattern) => !new RegExp(pattern, "i").test(text),
  );
  return { pass: missing.length === 0, missing };
}

function matchesAny(text: string, patterns: readonly string[] = []) {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

function weekdayIn(date: Date, zone = ZONE): number {
  const name = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: zone,
  })
    .format(date)
    .toLowerCase();
  return DOW_NAMES.indexOf(name.slice(0, 3));
}

function dayKey(date: Date, zone = ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
}

/** The next `weekday` strictly after `from`, as a Europe/Berlin day key. */
export function nextWeekdayKey(from: Date, weekday: number): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = new Date(from.getTime() + offset * 86_400_000);
    if (weekdayIn(day) === weekday) return dayKey(day);
  }
  return dayKey(from);
}

export interface CheckContext {
  lane: EvalLaneRecord;
  world: JourneyWorld;
  journey: OwnerJourney;
  journeyStartedAt: Date;
  stepStartedAt: Date;
  /** Every tool call of the journey so far, oldest first. */
  toolCalls: {
    capability: string;
    status: string;
    input: unknown;
    result: unknown;
  }[];
  botId: string;
  /** What the owner read at the end of this step. */
  answer: string | null;
  /** Kept across the journey's steps: what one step's check saw for the next. */
  memo: Record<string, string[]>;
}

async function scheduleCheck(
  outcome: Extract<JourneyOutcome, { kind: "schedule" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: context.botId, systemKey: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      cronExpression: true,
      prompt: true,
      timezone: true,
      enabled: true,
      runOnce: true,
    },
  });
  const [rememberedId, rememberedCron, rememberedPrompt, rememberedZone] =
    context.memo.schedule ?? [];
  const compared =
    outcome.identity === "unchanged" || outcome.identity === "edited";
  const latest = compared
    ? schedules.find((schedule) => schedule.id === rememberedId)
    : schedules[0];
  if (!latest)
    return {
      label: outcome.label,
      pass: false,
      actual: compared
        ? `the owner's schedule ${rememberedId ?? "(none remembered)"} is gone; ${schedules.length} other(s)`
        : "no schedule",
    };
  if (outcome.identity === "remember")
    context.memo.schedule = [
      latest.id,
      latest.cronExpression,
      latest.prompt,
      latest.timezone,
    ];
  const problems: string[] = [];
  if (!latest.enabled) problems.push("disabled");
  // Neither a run nor "move it to 7:30" changes the owner's time zone; a
  // step that asks for a new zone says which (outcome.timezone, below).
  if (compared && !outcome.timezone && latest.timezone !== rememberedZone)
    problems.push(`time zone ${rememberedZone} → ${latest.timezone}`);
  if (outcome.count !== undefined && schedules.length !== outcome.count)
    problems.push(`${schedules.length} schedules`);
  if (
    outcome.identity === "unchanged" &&
    (latest.cronExpression !== rememberedCron ||
      latest.prompt !== rememberedPrompt)
  )
    problems.push("cron or brief changed by the run");
  if (
    outcome.identity === "edited" &&
    latest.cronExpression === rememberedCron &&
    latest.prompt === rememberedPrompt &&
    latest.timezone === rememberedZone
  )
    problems.push("not changed");
  const avoided = (outcome.promptAvoids ?? []).filter((pattern) =>
    new RegExp(pattern, "i").test(latest.prompt),
  );
  if (avoided.length)
    problems.push(`prompt still says /${avoided.join("/, /")}/`);
  if (outcome.days) {
    const days = cronDays(latest.cronExpression);
    if (days.join() !== [...outcome.days].sort().join())
      problems.push(`days ${days.join(",")}`);
  }
  const time = cronTime(latest.cronExpression);
  if (outcome.hour !== undefined && time?.hour !== outcome.hour)
    problems.push(`hour ${time?.hour ?? "?"}`);
  if (outcome.minute !== undefined && time?.minute !== outcome.minute)
    problems.push(`minute ${time?.minute ?? "?"}`);
  if (outcome.timezone && latest.timezone !== outcome.timezone)
    problems.push(latest.timezone);
  if (outcome.runOnce !== undefined && latest.runOnce !== outcome.runOnce)
    problems.push(latest.runOnce ? "one-time" : "recurring");
  const coworkerParts = outcome.withTaskSchedules
    ? await prisma.taskSchedule.findMany({
        where: {
          workspaceId: context.lane.workspaceId,
          creatorSokoBotId: context.botId,
          createdAt: { gte: context.journeyStartedAt },
          state: "ACTIVE",
          assigneeId: { not: null },
        },
        select: {
          name: true,
          description: true,
          assignee: { select: { name: true } },
        },
      })
    : [];
  const prompt = matchesAll(
    [
      latest.prompt,
      ...coworkerParts.map((part) =>
        [part.assignee?.name, part.name, part.description].join("\n"),
      ),
    ].join("\n"),
    outcome.promptMatches,
  );
  if (!prompt.pass)
    problems.push(`prompt lacks /${prompt.missing.join("/, /")}/`);
  return {
    label: outcome.label,
    pass: problems.length === 0,
    actual: problems.length
      ? `${problems.join("; ")} (cron "${latest.cronExpression}")`
      : `cron "${latest.cronExpression}" ${latest.timezone}`,
  };
}

/** Tasks for the Coworker since the journey started: assigned, or proposed for approval. */
export async function coworkerTasks(
  context: Pick<CheckContext, "lane" | "world" | "journeyStartedAt" | "botId">,
  coworkerId: string,
) {
  const proposed = await prisma.sokoBotPendingDecision.findMany({
    where: {
      sokoBotId: context.botId,
      createdAt: { gte: context.journeyStartedAt },
    },
    select: { proposal: true, resultingEntityId: true },
  });
  const proposedTaskIds = proposed
    .filter((decision) =>
      JSON.stringify(decision.proposal).includes(coworkerId),
    )
    .flatMap((decision) => {
      const proposal = decision.proposal as { taskId?: unknown } | null;
      return [
        ...(typeof proposal?.taskId === "string" ? [proposal.taskId] : []),
        ...(decision.resultingEntityId ? [decision.resultingEntityId] : []),
      ];
    });
  return prisma.task.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      archivedAt: null,
      OR: [
        {
          assigneeId: coworkerId,
          updatedAt: { gte: context.journeyStartedAt },
        },
        { id: { in: proposedTaskIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, description: true, status: true },
  });
}

async function taskCheck(
  outcome: Extract<JourneyOutcome, { kind: "task" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const tasks = await coworkerTasks(
    context,
    context.world.coworkers[outcome.coworker],
  );
  const min = outcome.min ?? 1;
  const briefed = tasks.filter(
    (task) =>
      matchesAll(
        `${task.name}\n${task.description ?? ""}`,
        outcome.briefMatches,
      ).pass,
  );
  const first = tasks[0];
  return {
    label: outcome.label,
    pass: briefed.length >= min,
    actual:
      tasks.length === 0
        ? `no Task for ${outcome.coworker}`
        : briefed.length >= min
          ? `${briefed.length} briefed Task(s): "${briefed[0]?.name}"`
          : `brief lacks /${matchesAll(`${first?.name}\n${first?.description ?? ""}`, outcome.briefMatches).missing.join("/, /")}/ in "${first?.name}"`,
  };
}

async function imagesCheck(
  outcome: Extract<JourneyOutcome, { kind: "images" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const since = outcome.thisStep
    ? context.stepStartedAt
    : context.journeyStartedAt;
  const [jobs, files] = await Promise.all([
    imageJobs(context, since),
    madeImageFiles(context, since),
  ]);
  const made = madeImages(jobs, files);
  // Only a studio job carries a prompt; how an uploaded file looks is the
  // judge's to grade.
  const off = jobs
    .filter(isMade)
    .filter(
      (job) =>
        !matchesAll(job.prompt, outcome.promptMatches).pass ||
        matchesAny(job.prompt, outcome.promptAvoids),
    );
  const countOk =
    made >= outcome.min && (outcome.max === undefined || made <= outcome.max);
  const unfinished = jobs.filter((job) => !isMade(job)).length;
  return {
    label: outcome.label,
    pass: countOk && off.length === 0,
    actual: `${made} image(s) made${unfinished ? `, ${unfinished} failed or unfinished` : ""}${
      off.length
        ? `; ${off.length} off-brief: "${off[0]?.prompt.slice(0, 80)}"`
        : ""
    }`,
  };
}

function imageJobs(context: CheckContext, since: Date) {
  return prisma.projectImageJob.findMany({
    where: { workspaceId: context.lane.workspaceId, createdAt: { gte: since } },
    select: {
      id: true,
      prompt: true,
      status: true,
      asset: { select: { id: true } },
    },
  });
}

/** An image the owner can see: the job succeeded and kept its picture. */
function isMade(job: {
  status: string;
  asset: { id: string } | null;
}): boolean {
  return job.status === "SUCCEEDED" && job.asset !== null;
}

/**
 * Image files that landed in the owner's Files since `since` and are still
 * there: uploads the bot wrote (an SVG) and studio images copied in alike.
 */
function madeImageFiles(context: CheckContext, since: Date) {
  return prisma.fileResource.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      sourceKind: "DRIVE_UPLOAD",
      lifecycle: "ACTIVE",
      tombstonedAt: null,
      createdAt: { gte: since },
      mimeType: { startsWith: "image/" },
    },
    select: { sourceId: true, displayName: true },
  });
}

/** A studio image's Files copy ends in its job id's last eight hex digits (`studioAssetFileName`). */
function jobSuffix(jobId: string): string {
  return `-${jobId.replace(/-/g, "").slice(-8)}.`;
}

/**
 * Distinct images made: every image file in Files, plus each finished studio
 * job not copied into Files yet.
 */
export function madeImages(
  jobs: readonly {
    id: string;
    status: string;
    asset: { id: string } | null;
  }[],
  files: readonly { displayName: string }[],
): number {
  const uncopied = jobs
    .filter(isMade)
    .filter(
      (job) =>
        !files.some((file) => file.displayName.includes(jobSuffix(job.id))),
    );
  return files.length + uncopied.length;
}

/**
 * The media a post carries that the owner can open and this journey made:
 * distinct refs whose file is in `files`.
 */
export function attachedMadeMedia(
  media: unknown,
  files: readonly { sourceId: string }[],
): { total: number; made: number } {
  const pathnames = new Set(
    (Array.isArray(media) ? media : []).flatMap((ref) =>
      ref && typeof ref === "object" && "pathname" in ref
        ? [String(ref.pathname)]
        : [],
    ),
  );
  const known = new Set(files.map((file) => file.sourceId));
  return {
    total: pathnames.size,
    made: [...pathnames].filter((pathname) => known.has(pathname)).length,
  };
}

async function journeyPosts(
  context: CheckContext,
  projectId: string,
  since: Date,
) {
  return prisma.socialPost.findMany({
    where: {
      projectId,
      OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      text: true,
      status: true,
      media: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
}

async function postsCheck(
  outcome: Extract<JourneyOutcome, { kind: "posts" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const since = outcome.thisStep
    ? context.stepStartedAt
    : context.journeyStartedAt;
  const posts = (
    await journeyPosts(context, context.world.projects[outcome.project], since)
  ).filter(
    (post) =>
      post.status !== "CANCELED" &&
      (!outcome.provider || post.provider === outcome.provider) &&
      (!outcome.about || new RegExp(outcome.about, "i").test(post.text)),
  );
  const problems: string[] = [];
  if (
    posts.length < outcome.min ||
    (outcome.max !== undefined && posts.length > outcome.max)
  )
    problems.push(`${posts.length} post(s)`);
  if (outcome.draftsOnly) {
    const out = posts.filter((post) => !DRAFT_STATUSES.includes(post.status));
    if (out.length)
      problems.push(`${out.length} not DRAFT (${out[0]?.status})`);
  }
  if (outcome.media) {
    // Images this journey made and the owner can open, attached to the
    // draft itself: an unrelated attachment, a deleted file or a picture left
    // beside the draft is not something to approve.
    const files = await madeImageFiles(context, context.journeyStartedAt);
    for (const post of posts) {
      const { total, made } = attachedMadeMedia(post.media, files);
      if (made < outcome.media.min)
        problems.push(
          `${made} made image(s) attached of ${total} media, needs ${outcome.media.min}`,
        );
      if (outcome.media.max !== undefined && total > outcome.media.max)
        problems.push(`${total} media, at most ${outcome.media.max}`);
    }
  }
  if (outcome.linkedInAnswer) {
    const unlinked = posts.filter(
      (post) => !(context.answer ?? "").includes(post.id),
    );
    if (unlinked.length)
      problems.push("the answer does not link the draft to approve");
  }
  if (outcome.maxLength !== undefined) {
    const long = posts.filter(
      (post) => post.text.length > (outcome.maxLength ?? 0),
    );
    if (long.length) problems.push(`${long[0]?.text.length} chars`);
  }
  const missing = (outcome.textMatches ?? []).filter(
    (pattern) =>
      !posts.some((post) => new RegExp(pattern, "i").test(post.text)),
  );
  if (missing.length) problems.push(`no post says /${missing.join("/, /")}/`);
  if (outcome.networks !== undefined) {
    const networks = new Set(posts.map((post) => post.provider));
    if (networks.size < outcome.networks)
      problems.push(`networks: ${[...networks].join(",") || "none"}`);
  }
  return {
    label: outcome.label,
    pass: problems.length === 0,
    actual: problems.length
      ? problems.join("; ")
      : `${posts.length} post(s): "${posts[0]?.text.slice(0, 70) ?? ""}"`,
  };
}

async function noPostsCheck(
  outcome: Extract<JourneyOutcome, { kind: "noPosts" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const posts = await prisma.socialPost.count({
    where: {
      projectId: context.world.projects[outcome.project],
      createdAt: { gte: context.journeyStartedAt },
    },
  });
  return {
    label: outcome.label,
    pass: posts === 0,
    actual: `${posts} post(s)`,
  };
}

/** Waiting for the owner: a draft, or one put up for approval. */
const DRAFT_STATUSES: readonly string[] = ["DRAFT", "NEEDS_APPROVAL"];

const SENDING_TOOLS = [
  "publish_social_post",
  "send_email_draft",
  "publish_announcement",
];

async function nothingSentCheck(
  outcome: Extract<JourneyOutcome, { kind: "nothingSent" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const sending = [
    ...SENDING_TOOLS,
    ...(outcome.schedulingCounts ? ["schedule_social_post"] : []),
  ];
  const called = context.toolCalls.filter((call) =>
    sending.includes(call.capability),
  );
  const live = await prisma.socialPost.count({
    where: {
      workspaceId: context.lane.workspaceId,
      updatedAt: { gte: context.journeyStartedAt },
      status: {
        in: outcome.schedulingCounts
          ? ["PUBLISHED", "SCHEDULED", "PUBLISHING"]
          : ["PUBLISHED", "PUBLISHING"],
      },
      ...(outcome.schedulingCounts
        ? {}
        : { createdAt: { gte: context.journeyStartedAt } }),
    },
  });
  const sentIssues = await prisma.newsletterIssue.count({
    where: {
      workspaceId: context.lane.workspaceId,
      updatedAt: { gte: context.journeyStartedAt },
      status: { in: ["SCHEDULED", "SENDING", "SENT"] },
    },
  });
  return {
    label: outcome.label,
    pass: called.length === 0 && live === 0 && sentIssues === 0,
    actual:
      called.length || live || sentIssues
        ? `${called.map((call) => call.capability).join(", ") || "no send tool"}; ${live} live post(s); ${sentIssues} newsletter issue(s) out`
        : "nothing went out",
  };
}

async function launchSequenceCheck(
  outcome: Extract<JourneyOutcome, { kind: "launchSequence" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const launch = launchDay(context.journeyStartedAt, outcome);
  const posts = (
    await journeyPosts(
      context,
      context.world.projects.Cuso,
      context.journeyStartedAt,
    )
  ).filter(
    (post) =>
      post.status !== "CANCELED" &&
      post.scheduledAt &&
      new RegExp(outcome.about, "i").test(post.text),
  );
  const days = posts.map((post) => dayKey(post.scheduledAt as Date));
  const before = days.filter((day) => day < launch).length;
  const on = days.filter((day) => day === launch).length;
  const after = days.filter((day) => day > launch).length;
  const problems: string[] = [];
  if (!(before > 0 && on > 0 && after > 0)) problems.push("not around the day");
  const ids = posts.map((post) => post.id);
  if (outcome.movedFrom === undefined) context.memo.launchPieces = ids;
  else {
    const earlier = new Set(context.memo.launchPieces ?? []);
    const kept = ids.filter((id) => earlier.has(id)).length;
    if (earlier.size === 0) problems.push("no earlier launch pieces to move");
    else if (kept < earlier.size)
      problems.push(
        `${earlier.size - kept} of ${earlier.size} earlier pieces gone`,
      );
    if (ids.length > earlier.size)
      problems.push(`${ids.length - earlier.size} added instead of moved`);
  }
  return {
    label: outcome.label,
    pass: problems.length === 0,
    actual: `launch ${launch}: ${before} before, ${on} on the day, ${after} after${problems.length ? ` (${problems.join("; ")})` : ""}`,
  };
}

/**
 * The launch day as a Berlin day key: the next `weekday` after the journey
 * started, or, for a moved launch, the first `weekday` from the original day
 * on ("push it to Thursday" keeps the launch week).
 */
export function launchDay(
  journeyStartedAt: Date,
  outcome: { weekday: number; movedFrom?: number },
): string {
  if (outcome.movedFrom === undefined)
    return nextWeekdayKey(journeyStartedAt, outcome.weekday);
  const original = nextWeekdayKey(journeyStartedAt, outcome.movedFrom);
  const start = new Date(`${original}T12:00:00Z`);
  return outcome.weekday === outcome.movedFrom
    ? original
    : nextWeekdayKey(start, outcome.weekday);
}

async function networkShiftCheck(
  outcome: Extract<JourneyOutcome, { kind: "networkShift" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const counts = await upcomingByNetwork(
    context.world.projects.Cuso,
    context.stepStartedAt,
  );
  const before = context.world.upcomingByNetwork ?? {};
  const fewer = (counts[outcome.from] ?? 0) < (before[outcome.from] ?? 0);
  const more = (counts[outcome.to] ?? 0) > (before[outcome.to] ?? 0);
  return {
    label: outcome.label,
    pass: fewer || more,
    actual: `${outcome.from} ${before[outcome.from] ?? 0} → ${counts[outcome.from] ?? 0}, ${outcome.to} ${before[outcome.to] ?? 0} → ${counts[outcome.to] ?? 0}`,
  };
}

/** Upcoming posts per network on a Project, from `after` on. */
export async function upcomingByNetwork(
  projectId: string,
  after: Date,
): Promise<Record<string, number>> {
  const rows = await prisma.socialPost.groupBy({
    by: ["provider"],
    where: {
      projectId,
      status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      scheduledAt: { gt: after },
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.provider, row._count._all]));
}

async function noPostsOnWeekdayCheck(
  outcome: Extract<JourneyOutcome, { kind: "noPostsOnWeekday" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const upcoming = await prisma.socialPost.findMany({
    where: {
      projectId: context.world.projects.Cuso,
      status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      scheduledAt: { gt: context.stepStartedAt },
    },
    select: { id: true, scheduledAt: true, timezone: true },
  });
  const hits = upcoming.filter(
    (post) =>
      post.scheduledAt &&
      weekdayIn(post.scheduledAt, post.timezone ?? ZONE) === outcome.weekday,
  );
  // The seeded posts on that day must be moved, not silently dropped.
  const seeded = context.world.seededWeekdayPostIds ?? [];
  const live = new Set(upcoming.map((post) => post.id));
  const dropped = seeded.filter((id) => !live.has(id)).length;
  return {
    label: outcome.label,
    pass: seeded.length > 0 && hits.length === 0 && dropped === 0,
    actual: `${hits.length} of ${upcoming.length} upcoming post(s) on that day; ${dropped} of ${seeded.length} seeded ones dropped`,
  };
}

async function seededPostCheck(
  outcome: Extract<JourneyOutcome, { kind: "seededPostFixed" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const post = context.world.seededPostId
    ? await prisma.socialPost.findUnique({
        where: { id: context.world.seededPostId },
        select: { text: true, status: true },
      })
    : null;
  const fixed =
    !post ||
    post.status === "CANCELED" ||
    !new RegExp(outcome.avoids, "i").test(post.text);
  return {
    label: outcome.label,
    pass: fixed,
    actual: post ? `${post.status}: "${post.text.slice(0, 70)}"` : "deleted",
  };
}

async function tableCheck(
  outcome: Extract<JourneyOutcome, { kind: "table" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const ids = createdTableIds(context.toolCalls);
  const tables = await prisma.dataTable.findMany({
    where: { id: { in: ids }, workspaceId: context.lane.workspaceId },
    select: {
      title: true,
      rows: { where: { archivedAt: null }, select: { values: true } },
    },
  });
  const graded = tables.map((table) => ({
    title: table.title,
    ...gradeRows(
      table.rows.map((row) => JSON.stringify(row.values)),
      outcome,
    ),
  }));
  const best = graded.sort((a, b) => b.good - a.good)[0];
  return {
    label: outcome.label,
    pass: Boolean(best) && (best?.problems.length ?? 1) === 0,
    actual: best
      ? `"${best.title}": ${best.good} good of ${best.rows} rows${best.problems.length ? `; ${best.problems.join("; ")}` : ""}`
      : "this journey created no table",
  };
}

/** The tables this journey's own create_table calls returned. */
export function createdTableIds(
  calls: readonly { capability: string; status: string; result: unknown }[],
): string[] {
  return calls.flatMap((call) => {
    if (call.capability !== "create_table" || call.status === "FAILED")
      return [];
    const id = (call.result as { table?: { id?: unknown } } | null)?.table?.id;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * Every whole URL in a text, trailing punctuation and a closing slash off,
 * so a longer path under the right one is a different URL, not a match.
 */
export function urlsIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s"'<>)\]}]+/g) ?? []).map((url) =>
    url.replace(/[.,;:!?]+$/, "").replace(/\/$/, ""),
  );
}

/**
 * Rows as text, graded against the notes: a good row names one fitting fund
 * with that fund's own partner, deal and source link, and no other row did
 * before it. A known name with someone else's link, or none, is not good.
 */
export function gradeRows(
  rows: readonly string[],
  outcome: {
    minRows: number;
    allowed: readonly FixtureInvestor[];
    excluded: readonly FixtureInvestor[];
  },
): { rows: number; good: number; problems: string[] } {
  const seen = new Set<string>();
  let good = 0;
  let incomplete = 0;
  let unknown = 0;
  let repeated = 0;
  const excluded = new Set<string>();
  const has = (row: string, value: string) =>
    row.toLowerCase().includes(value.toLowerCase());
  for (const row of rows) {
    for (const misfit of outcome.excluded)
      if (has(row, misfit.fund)) excluded.add(misfit.fund);
    const entry = outcome.allowed.find((fit) => has(row, fit.fund));
    if (!entry) unknown += 1;
    else if (seen.has(entry.fund)) repeated += 1;
    else if (
      !has(row, entry.partner) ||
      !has(row, entry.startup) ||
      !urlsIn(row).includes(entry.source)
    )
      incomplete += 1;
    else {
      seen.add(entry.fund);
      good += 1;
    }
  }
  const problems = [
    ...(good < outcome.minRows ? [`needs ${outcome.minRows}`] : []),
    ...(incomplete
      ? [`${incomplete} without the fund's own partner, deal and source`]
      : []),
    ...(repeated ? [`${repeated} repeated`] : []),
    ...(unknown ? [`${unknown} not from the notes`] : []),
    ...(excluded.size ? [`includes ${[...excluded].join(", ")}`] : []),
  ];
  return { rows: rows.length, good, problems };
}

async function newsletterCheck(
  outcome: Extract<JourneyOutcome, { kind: "newsletterDraft" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const issues = await prisma.newsletterIssue.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      createdAt: { gte: context.journeyStartedAt },
    },
    select: { status: true, subject: true, content: true },
  });
  const draft = issues.find((issue) => DRAFT_STATUSES.includes(issue.status));
  const text = `${draft?.subject ?? ""}\n${JSON.stringify(draft?.content ?? "")}`;
  const matched = matchesAll(text, outcome.textMatches);
  return {
    label: outcome.label,
    pass: Boolean(draft) && matched.pass,
    actual: draft
      ? matched.pass
        ? `draft "${draft.subject}"`
        : `draft lacks /${matched.missing.join("/, /")}/`
      : `${issues.length} issue(s), no draft`,
  };
}

function readSeededFileCheck(
  outcome: Extract<JourneyOutcome, { kind: "readSeededFile" }>,
  context: CheckContext,
): ScenarioCheck {
  const id = context.world.seededFileId ?? "";
  const marker = context.world.seededFileMarker ?? "";
  const reads = context.toolCalls.filter(
    (call) =>
      ["read_file", "workspace_import_file"].includes(call.capability) &&
      call.status !== "FAILED" &&
      JSON.stringify(call.input ?? "").includes(id),
  );
  // A read that came back empty ("still being processed") is no read: the
  // file's own text, a phrase only it holds, has to be in what came back.
  const withText = reads.some((call) =>
    JSON.stringify(call.result ?? "").includes(marker),
  );
  return {
    label: outcome.label,
    pass: Boolean(id && marker) && withText,
    actual: withText
      ? "read, with its text"
      : reads.length
        ? `${reads.length} read(s), none returned the file's text`
        : "never read",
  };
}

async function seededSchedulesCheck(
  outcome: Extract<JourneyOutcome, { kind: "seededSchedulesUntouched" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const seeded = (context.world.seededSchedules ?? []).filter(
    (schedule) => schedule.sokoBotId !== context.botId,
  );
  const rows = await prisma.sokoBotSchedule.findMany({
    where: { id: { in: seeded.map((schedule) => schedule.id) } },
    select: { id: true, enabled: true, cronExpression: true, prompt: true },
  });
  const changed = seeded.filter((before) => {
    const after = rows.find((row) => row.id === before.id);
    return (
      !after ||
      after.enabled !== before.enabled ||
      after.cronExpression !== before.cronExpression ||
      after.prompt !== before.prompt
    );
  });
  return {
    label: outcome.label,
    pass: seeded.length > 0 && changed.length === 0,
    actual: changed.length
      ? `${changed.length} of ${seeded.length} changed or deleted`
      : `${seeded.length} unchanged`,
  };
}

async function contactCheck(
  outcome: Extract<JourneyOutcome, { kind: "contact" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const since = context.journeyStartedAt;
  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      OR: [
        { updatedAt: { gte: since } },
        { interactions: { some: { createdAt: { gte: since } } } },
      ],
    },
    select: {
      name: true,
      organization: true,
      role: true,
      summary: true,
      whyInteresting: true,
      nextStep: true,
      customFields: true,
      interactions: { select: { summary: true } },
    },
  });
  const named = contacts.filter((contact) =>
    new RegExp(outcome.nameMatches, "i").test(contact.name),
  );
  const notes = (contact: (typeof contacts)[number]) =>
    [
      contact.organization,
      contact.role,
      contact.summary,
      contact.whyInteresting,
      contact.nextStep,
      JSON.stringify(contact.customFields),
      ...contact.interactions.map((interaction) => interaction.summary),
    ]
      .filter(Boolean)
      .join("\n");
  const good = named.find(
    (contact) => matchesAll(notes(contact), outcome.notesMatch).pass,
  );
  const first = named[0];
  return {
    label: outcome.label,
    pass: Boolean(good),
    actual: good
      ? `"${good.name}"`
      : first
        ? `"${first.name}" lacks /${matchesAll(notes(first), outcome.notesMatch).missing.join("/, /")}/`
        : `${contacts.length} contact(s) touched, none named /${outcome.nameMatches}/`,
  };
}

/**
 * Text files the journey saved to Files and that are still there, with
 * their text: what the last upload_file whose receipt names the file wrote,
 * else the text Files indexed (a sandbox upload sends a workspace path, not
 * the content).
 */
export function savedFileTexts(
  files: readonly { id: string; displayName: string }[],
  toolCalls: CheckContext["toolCalls"],
  indexed: Readonly<Record<string, string>> = {},
): { name: string; text: string | null }[] {
  return files.map((file) => {
    const write = toolCalls
      .filter(
        (call) =>
          call.capability === "upload_file" &&
          call.status !== "FAILED" &&
          (call.result as { id?: unknown } | null)?.id === file.id,
      )
      .map((call) => (call.input as { content?: unknown } | null)?.content)
      .at(-1);
    return {
      name: file.displayName,
      text: typeof write === "string" ? write : (indexed[file.id] ?? null),
    };
  });
}

/**
 * Each file's indexed text, from its latest revision only: a newer revision
 * still being indexed has no text yet, and an older revision's text is not
 * what the file says now.
 */
export async function indexedTexts(
  fileIds: readonly string[],
): Promise<Record<string, string>> {
  const versions = await prisma.fileVersion.findMany({
    where: { resourceId: { in: [...fileIds] } },
    orderBy: { revision: "desc" },
    select: {
      resourceId: true,
      chunks: { orderBy: { ordinal: "asc" }, select: { text: true } },
    },
  });
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions)
    if (!latest.has(version.resourceId))
      latest.set(version.resourceId, version);
  const texts: Record<string, string> = {};
  for (const [id, version] of latest)
    if (version.chunks.length)
      texts[id] = version.chunks.map((chunk) => chunk.text).join("\n");
  return texts;
}

async function fileCheck(
  outcome: Extract<JourneyOutcome, { kind: "file" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const files = await prisma.fileResource.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      sourceKind: "DRIVE_UPLOAD",
      lifecycle: "ACTIVE",
      tombstonedAt: null,
      createdAt: { gte: context.journeyStartedAt },
      NOT: { mimeType: { startsWith: "image/" } },
    },
    select: { id: true, displayName: true },
  });
  const saved = savedFileTexts(
    files,
    context.toolCalls,
    await indexedTexts(files.map((file) => file.id)),
  ).filter(
    (file) =>
      !outcome.nameMatches ||
      new RegExp(outcome.nameMatches, "i").test(file.name),
  );
  const good = saved.find(
    (file) =>
      file.text !== null &&
      matchesAll(file.text, outcome.textMatches).pass &&
      !matchesAny(file.text, outcome.textAvoids),
  );
  const first = saved[0];
  return {
    label: outcome.label,
    pass: Boolean(good),
    actual: good
      ? `"${good.name}"`
      : !first
        ? `${files.length} file(s) saved, none matching`
        : first.text === null
          ? `"${first.name}" has no text to check`
          : `"${first.name}" lacks /${matchesAll(first.text, outcome.textMatches).missing.join("/, /")}/ or says what it should not`,
  };
}

async function taskReplyCheck(
  outcome: Extract<JourneyOutcome, { kind: "taskReply" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const replies = await prisma.taskEvent.findMany({
    where: {
      sokoBotId: context.botId,
      createdAt: { gte: context.stepStartedAt },
      comment: { not: null },
      task: {
        workspaceId: context.lane.workspaceId,
        assigneeId: context.world.coworkers[outcome.coworker],
      },
    },
    select: { comment: true },
  });
  const good = replies.find(
    (reply) => matchesAll(reply.comment ?? "", outcome.textMatches).pass,
  );
  return {
    label: outcome.label,
    pass: Boolean(good),
    actual: good
      ? `"${good.comment?.slice(0, 70)}"`
      : `${replies.length} comment(s) on ${outcome.coworker}'s Tasks, none matching`,
  };
}

async function scheduledPostsCheck(
  outcome: Extract<JourneyOutcome, { kind: "scheduledPosts" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const scheduled = await prisma.socialPost.count({
    where: { projectId: context.world.projects.Cuso, status: "SCHEDULED" },
  });
  return {
    label: outcome.label,
    pass:
      (outcome.min === undefined || scheduled >= outcome.min) &&
      (outcome.max === undefined || scheduled <= outcome.max),
    actual: `${scheduled} scheduled`,
  };
}

async function publishedUntouchedCheck(
  outcome: Extract<JourneyOutcome, { kind: "publishedUntouched" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const seeded = context.world.seededPublished ?? [];
  const rows = await prisma.socialPost.findMany({
    where: { id: { in: seeded.map((post) => post.id) } },
    select: { id: true, text: true, status: true, media: true },
  });
  const changed = seeded.filter((before) => {
    const after = rows.find((row) => row.id === before.id);
    return (
      !after ||
      after.status !== "PUBLISHED" ||
      after.text !== before.text ||
      !samePathnames(after.media, before.pathnames)
    );
  });
  return {
    label: outcome.label,
    pass: seeded.length > 0 && changed.length === 0,
    actual: changed.length
      ? `${changed.length} of ${seeded.length} changed or removed`
      : `${seeded.length} unchanged`,
  };
}

/**
 * The pathnames a post's media holds, in its order: comparable however jsonb
 * orders an attachment's keys, while a reordering of the attachments shows.
 */
export function mediaPathnames(media: unknown): string[] {
  return (Array.isArray(media) ? media : []).flatMap((ref) =>
    ref && typeof ref === "object" && "pathname" in ref
      ? [String(ref.pathname)]
      : [],
  );
}

function samePathnames(media: unknown, before: readonly string[]): boolean {
  return mediaPathnames(media).join("\n") === before.join("\n");
}

/** Problems with the target picture post: replaced on the same post, the rest left as they were. */
export function pictureProblems(
  seeded: NonNullable<JourneyWorld["seededPicture"]>,
  post: { text: string; status: string; media: unknown } | null,
  others: readonly { id: string; media: unknown }[],
  madeFiles: readonly { sourceId: string }[],
): string[] {
  if (!post) return ["the post is gone"];
  const problems: string[] = [];
  if (post.status === "CANCELED") problems.push("the post was cancelled");
  if (post.text !== seeded.text) problems.push("its text changed");
  if (mediaPathnames(post.media).includes(seeded.pathname))
    problems.push("the old picture is still on it");
  if (attachedMadeMedia(post.media, madeFiles).made === 0)
    problems.push("no picture made in this journey on it");
  const changed = seeded.others.filter((before) => {
    const other = others.find((row) => row.id === before.postId);
    return !other || !samePathnames(other.media, before.pathnames);
  });
  if (changed.length)
    problems.push(`${changed.length} other picture(s) changed`);
  return problems;
}

async function seededPictureCheck(
  outcome: Extract<JourneyOutcome, { kind: "seededPictureReplaced" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const seeded = context.world.seededPicture;
  if (!seeded)
    return { label: outcome.label, pass: false, actual: "no seeded picture" };
  const [post, others, files, jobs] = await Promise.all([
    prisma.socialPost.findUnique({
      where: { id: seeded.postId },
      select: { text: true, status: true, media: true },
    }),
    prisma.socialPost.findMany({
      where: { id: { in: seeded.others.map((other) => other.postId) } },
      select: { id: true, media: true },
    }),
    madeImageFiles(context, context.journeyStartedAt),
    imageJobs(context, context.journeyStartedAt),
  ]);
  const problems = pictureProblems(seeded, post, others, files);
  const off = jobs
    .filter(isMade)
    .filter((job) => matchesAny(job.prompt, outcome.promptAvoids));
  if (off.length)
    problems.push(`${off.length} image(s) matched an avoided prompt pattern`);
  return {
    label: outcome.label,
    pass: problems.length === 0,
    actual: problems.length
      ? problems.join("; ")
      : "replaced, nothing else changed",
  };
}

async function noHiresCheck(
  outcome: Extract<JourneyOutcome, { kind: "noHires" }>,
  context: CheckContext,
): Promise<ScenarioCheck> {
  const hires = context.toolCalls.filter(
    (call) => call.capability === "hire_agent" && call.status !== "FAILED",
  ).length;
  const jobs = await createNetworkScope("mainnet").networkDb.job.count({
    where: {
      workspaceId: context.lane.workspaceId,
      createdAt: { gte: context.journeyStartedAt },
    },
  });
  return {
    label: outcome.label,
    pass: hires === 0 && jobs === 0,
    actual: `${hires} hire(s), ${jobs} Job(s)`,
  };
}

export async function outcomeCheck(
  outcome: JourneyOutcome,
  context: CheckContext,
): Promise<ScenarioCheck> {
  switch (outcome.kind) {
    case "schedule":
      return scheduleCheck(outcome, context);
    case "task":
      return taskCheck(outcome, context);
    case "images":
      return imagesCheck(outcome, context);
    case "posts":
      return postsCheck(outcome, context);
    case "noPosts":
      return noPostsCheck(outcome, context);
    case "nothingSent":
      return nothingSentCheck(outcome, context);
    case "launchSequence":
      return launchSequenceCheck(outcome, context);
    case "noPostsOnWeekday":
      return noPostsOnWeekdayCheck(outcome, context);
    case "seededPostFixed":
      return seededPostCheck(outcome, context);
    case "table":
      return tableCheck(outcome, context);
    case "newsletterDraft":
      return newsletterCheck(outcome, context);
    case "readSeededFile":
      return readSeededFileCheck(outcome, context);
    case "seededSchedulesUntouched":
      return seededSchedulesCheck(outcome, context);
    case "networkShift":
      return networkShiftCheck(outcome, context);
    case "contact":
      return contactCheck(outcome, context);
    case "file":
      return fileCheck(outcome, context);
    case "taskReply":
      return taskReplyCheck(outcome, context);
    case "scheduledPosts":
      return scheduledPostsCheck(outcome, context);
    case "publishedUntouched":
      return publishedUntouchedCheck(outcome, context);
    case "seededPictureReplaced":
      return seededPictureCheck(outcome, context);
    case "noHires":
      return noHiresCheck(outcome, context);
  }
}
