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
  toolCalls: { capability: string; status: string; input: unknown }[];
  botId: string;
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
  const jobs = await prisma.projectImageJob.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      createdAt: {
        gte: outcome.thisStep
          ? context.stepStartedAt
          : context.journeyStartedAt,
      },
    },
    select: { prompt: true, status: true },
  });
  const usable = jobs.filter((job) => job.status !== "FAILED");
  const off = usable.filter(
    (job) => !matchesAll(job.prompt, outcome.promptMatches).pass,
  );
  const countOk =
    usable.length >= outcome.min &&
    (outcome.max === undefined || usable.length <= outcome.max);
  return {
    label: outcome.label,
    pass: countOk && off.length === 0,
    actual: `${usable.length} image(s)${jobs.length > usable.length ? `, ${jobs.length - usable.length} failed` : ""}${
      off.length
        ? `; ${off.length} off-brief: "${off[0]?.prompt.slice(0, 80)}"`
        : ""
    }`,
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
  if (outcome.withMedia) {
    const bare = posts.filter(
      (post) => !Array.isArray(post.media) || post.media.length === 0,
    );
    if (bare.length) problems.push(`${bare.length} without media`);
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
  const launch = nextWeekdayKey(context.journeyStartedAt, outcome.weekday);
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
  return {
    label: outcome.label,
    pass: before > 0 && on > 0 && after > 0,
    actual: `launch ${launch}: ${before} before, ${on} on the day, ${after} after`,
  };
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
    select: { scheduledAt: true, timezone: true },
  });
  const hits = upcoming.filter(
    (post) =>
      post.scheduledAt &&
      weekdayIn(post.scheduledAt, post.timezone ?? ZONE) === outcome.weekday,
  );
  return {
    label: outcome.label,
    pass: upcoming.length > 0 && hits.length === 0,
    actual: `${hits.length} of ${upcoming.length} upcoming post(s) on that day`,
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
  const tables = await prisma.dataTable.findMany({
    where: {
      workspaceId: context.lane.workspaceId,
      createdAt: { gte: context.journeyStartedAt },
    },
    select: { title: true, _count: { select: { rows: true } } },
  });
  const best = tables.sort((a, b) => b._count.rows - a._count.rows)[0];
  return {
    label: outcome.label,
    pass: (best?._count.rows ?? 0) >= outcome.minRows,
    actual: best ? `"${best.title}": ${best._count.rows} rows` : "no table",
  };
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
  }
}
