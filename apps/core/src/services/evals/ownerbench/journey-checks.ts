import type { ScenarioCheck } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "../eval-lanes.service";
import type { JourneyWorld } from "./journey-world";
import type { JourneyOutcome, OwnerJourney } from "./journeys";

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
      cronExpression: true,
      prompt: true,
      timezone: true,
      enabled: true,
    },
  });
  const latest = schedules[0];
  if (!latest)
    return { label: outcome.label, pass: false, actual: "no schedule" };
  const problems: string[] = [];
  if (outcome.count !== undefined && schedules.length !== outcome.count)
    problems.push(`${schedules.length} schedules`);
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
  const prompt = matchesAll(latest.prompt, outcome.promptMatches);
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
  const jobs = await imageJobs(
    context,
    outcome.thisStep ? context.stepStartedAt : context.journeyStartedAt,
  );
  const made = jobs.filter(isMade);
  const off = made.filter(
    (job) => !matchesAll(job.prompt, outcome.promptMatches).pass,
  );
  const countOk =
    made.length >= outcome.min &&
    (outcome.max === undefined || made.length <= outcome.max);
  const unfinished = jobs.length - made.length;
  return {
    label: outcome.label,
    pass: countOk && off.length === 0,
    actual: `${made.length} image(s) made${unfinished ? `, ${unfinished} failed or unfinished` : ""}${
      off.length
        ? `; ${off.length} off-brief: "${off[0]?.prompt.slice(0, 80)}"`
        : ""
    }`,
  };
}

function imageJobs(context: CheckContext, since: Date) {
  return prisma.projectImageJob.findMany({
    where: { workspaceId: context.lane.workspaceId, createdAt: { gte: since } },
    select: { id: true, prompt: true, status: true, assetId: true },
  });
}

/** An image the owner can see: the job succeeded and kept its picture. */
function isMade(job: { status: string; assetId: string | null }): boolean {
  return job.status === "SUCCEEDED" && job.assetId !== null;
}

/**
 * A studio image's Files copy ends in its job id's last eight hex digits
 * (`studioAssetFileName`), so a post's media names say which job made them.
 */
export function mediaFromJobs(
  media: unknown,
  jobIds: readonly string[],
): { total: number; fromJobs: number } {
  const refs = Array.isArray(media) ? media : [];
  const suffixes = jobIds.map((id) => `-${id.replace(/-/g, "").slice(-8)}.`);
  const fromJobs = refs.filter((ref) => {
    const name =
      ref && typeof ref === "object" && "name" in ref ? String(ref.name) : "";
    return suffixes.some((suffix) => name.includes(suffix));
  }).length;
  return { total: refs.length, fromJobs };
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
  if (outcome.withMedia) {
    // The journey's own made images, nothing else: an unrelated attachment
    // or a picture that never finished is not something to approve.
    const made = (await imageJobs(context, context.journeyStartedAt))
      .filter(isMade)
      .map((job) => job.id);
    for (const post of posts) {
      const { total, fromJobs } = mediaFromJobs(post.media, made);
      if (total === 0) problems.push("a post without media");
      else if (fromJobs < total)
        problems.push(
          `${total - fromJobs} of ${total} media not the made images`,
        );
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
 * Rows as text: how many name a different allowed entry and carry a link,
 * and what is wrong with the rest.
 */
export function gradeRows(
  rows: readonly string[],
  outcome: {
    minRows: number;
    allowed?: readonly string[];
    excluded?: readonly string[];
  },
): { rows: number; good: number; problems: string[] } {
  const seen = new Set<string>();
  let good = 0;
  let unsourced = 0;
  let unknown = 0;
  let repeated = 0;
  const excluded = new Set<string>();
  for (const row of rows) {
    const lower = row.toLowerCase();
    for (const name of outcome.excluded ?? [])
      if (lower.includes(name.toLowerCase())) excluded.add(name);
    const named = outcome.allowed
      ? outcome.allowed.find((name) => lower.includes(name.toLowerCase()))
      : row;
    if (!named) unknown += 1;
    else if (seen.has(named)) repeated += 1;
    else if (!/https?:\/\//.test(row)) unsourced += 1;
    else {
      seen.add(named);
      good += 1;
    }
  }
  const problems = [
    ...(good < outcome.minRows ? [`needs ${outcome.minRows}`] : []),
    ...(unsourced ? [`${unsourced} without a source link`] : []),
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
  const read = context.toolCalls.some(
    (call) =>
      ["read_file", "workspace_import_file"].includes(call.capability) &&
      call.status !== "FAILED" &&
      JSON.stringify(call.input ?? "").includes(id),
  );
  return {
    label: outcome.label,
    pass: Boolean(id) && read,
    actual: read ? "read" : "never read",
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
  }
}
