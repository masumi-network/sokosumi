import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";

type SiteSpeed = NonNullable<ProjectSeoWorkspace["siteSpeed"]>;
type SiteSpeedDevice = SiteSpeed["rows"][number]["devices"][number];
type MeasuredField = Extract<SiteSpeedDevice["field"], { status: "measured" }>;

/**
 * The CrUX History as a model reads it: one object per week, newest first. A tool result that is too long loses
 * items off the end of its longest lists, so a cut drops whole old weeks and keeps each value with its date.
 */
function modelHistory(history: MeasuredField["history"]) {
  if (!history) return history;
  const { status, weeks = [], lcp, inp, cls } = history;
  return {
    status,
    weeks: weeks
      .map((week, i) => ({
        week,
        ...(lcp && { lcp: lcp[i] ?? null }),
        ...(inp && { inp: inp[i] ?? null }),
        ...(cls && { cls: cls[i] ?? null }),
      }))
      .reverse(),
  };
}

/** A measurement as a model reads it: values, statuses and codes. A lab insight's text is the worker's: it is left out. */
function modelSpeedDevice({
  pageUrl,
  testedUrl,
  device,
  lab,
  field,
}: SiteSpeedDevice) {
  return {
    pageUrl,
    testedUrl,
    device,
    lab:
      lab.status === "measured"
        ? {
            status: lab.status,
            median: lab.median,
            runs: lab.runs,
            ok: lab.ok,
            ...(lab.pageSpeed && {
              pageSpeed: {
                scores: lab.pageSpeed.scores,
                measuredAt: lab.pageSpeed.measuredAt,
              },
            }),
          }
        : { status: lab.status },
    field:
      field.status === "measured"
        ? {
            status: field.status,
            level: field.level,
            url: field.url,
            p75: field.p75,
            period: field.period,
            history: modelHistory(field.history),
          }
        : { status: field.status },
  };
}

/**
 * The speed table as a model reads it (Soko Bot and MCP clients). The table holds the SEO worker's free text (a
 * row's `why` and `group`, a lab insight's sentences): it can carry instructions for a model, so only the SEO page
 * gets it. Each field of a row is named here: a new field of the table does not reach a model by default.
 */
export function modelSiteSpeed(siteSpeed: SiteSpeed) {
  return {
    ...siteSpeed,
    rows: siteSpeed.rows.map((row) => ({
      url: row.url,
      audited: row.audited,
      cause: row.cause,
      tier: row.tier,
      check: row.check,
      devices: row.devices.map(modelSpeedDevice),
    })),
  };
}

type ModelObservation = { pageSpeed?: SiteSpeedDevice[] };

/**
 * A workspace as a model reads it: the speed table (modelSiteSpeed) and each observation's speed reads in the same
 * shape. Any other field stays as it is.
 */
export function modelSeoWorkspace(workspace: object): Record<string, unknown>;
export function modelSeoWorkspace(workspace: unknown): unknown;
export function modelSeoWorkspace(workspace: unknown): unknown {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace))
    return workspace;
  const { siteSpeed, observations } = workspace as {
    siteSpeed?: unknown;
    observations?: unknown;
  };
  return {
    ...workspace,
    ...(Array.isArray((siteSpeed as { rows?: unknown } | null)?.rows) && {
      siteSpeed: modelSiteSpeed(siteSpeed as SiteSpeed),
    }),
    ...(Array.isArray(observations) && {
      observations: observations.map((observation: ModelObservation) =>
        Array.isArray(observation?.pageSpeed)
          ? {
              ...observation,
              pageSpeed: observation.pageSpeed.map(modelSpeedDevice),
            }
          : observation,
      ),
    }),
  };
}
