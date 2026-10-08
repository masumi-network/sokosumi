import type { z } from "@hono/zod-openapi";
import JSZip from "jszip";
import { csvField, csvLabel } from "@/helpers/transaction-history-csv";
import type {
  SocialPerformanceResponse,
  WorkspaceSocialPerformanceResponse,
} from "@/schemas/social-performance.schema";
import type { socialPerformanceAudienceResponseSchema } from "@/schemas/social-performance-research.schema";

type Cell = string | number | null;
interface ExportSheet {
  name: string;
  rows: Cell[][];
}
type AudiencePage = z.infer<typeof socialPerformanceAudienceResponseSchema>;
const METRICS = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

/** Both formats carry the same measured values; spreadsheet text never executes as a formula. */
export function socialPerformanceExportSheets(
  data: SocialPerformanceResponse | WorkspaceSocialPerformanceResponse,
): ExportSheet[] {
  const workspaceExport = "projects" in data;
  const projects = workspaceExport ? data.projects : [];
  const postProjects = workspaceExport
    ? new Map(data.posts.map((post) => [post.id, post.projectIds]))
    : new Map<string, string[]>();
  const projectByConnection = new Map<string, (typeof projects)[number]>();
  for (const project of projects)
    for (const connectionId of project.connectionIds)
      projectByConnection.set(connectionId, project);
  const projectColumns = workspaceExport ? ["project_id", "project_name"] : [];
  const attribution = (connectionId: string): Cell[] =>
    workspaceExport
      ? [
          projectByConnection.get(connectionId)?.id ?? null,
          projectByConnection.get(connectionId)?.name ?? null,
        ]
      : [];
  const postAttribution = (postId: string): Cell[] => {
    if (!workspaceExport) return [];
    const ids = postProjects.get(postId) ?? [];
    return [
      ids.join("; "),
      ids
        .map((id) => projects.find((project) => project.id === id)?.name ?? "")
        .join("; "),
    ];
  };
  const additionalKeys = [
    ...new Set(
      data.posts.flatMap((post) =>
        post.additionalMetrics.map((metric) => metric.key),
      ),
    ),
  ].sort();
  const posts: Cell[][] = [
    [
      "platform",
      "account_id",
      ...(workspaceExport ? ["project_ids", "project_names"] : []),
      "post_id",
      "published_at",
      "content_type",
      "post_kind",
      "text",
      "url",
      ...METRICS,
      "interactions",
      "engagement_rate_percent",
      "engagement_denominator",
      "baseline_multiplier",
      "measured_at",
      ...additionalKeys.flatMap((key) => [key, `${key}_period`, `${key}_unit`]),
      "publication_from",
      "publication_until",
      "timezone",
      "semantics",
      "history_complete",
    ],
  ];
  for (const post of data.posts) {
    posts.push([
      post.provider,
      post.connectionId,
      ...postAttribution(post.id),
      post.externalId,
      post.publishedAt,
      post.contentType,
      post.postKind,
      post.text,
      post.url,
      ...METRICS.map((key) => post.metrics[key]),
      post.interactions,
      post.engagementRate,
      post.engagementDenominator,
      post.baselineMultiplier,
      post.fetchedAt,
      ...additionalKeys.flatMap((key) => {
        const metric = post.additionalMetrics.find(
          (metric) => metric.key === key,
        );
        return [
          metric?.value ?? null,
          metric?.period ?? null,
          metric?.unit ?? null,
        ];
      }),
      data.range.publishedFrom,
      data.range.publishedUntil,
      data.range.timezone,
      data.range.semantics,
      String(data.coverage.historyComplete),
    ]);
  }
  const metadata: Cell[][] = [
    ["definition", "value"],
    ["publication_from", data.range.publishedFrom],
    ["publication_until", data.range.publishedUntil],
    ["previous_from", data.range.previousFrom],
    ["previous_until", data.range.previousUntil],
    ["timezone", data.range.timezone],
    ["semantics", data.range.semantics],
    ["history_complete", String(data.coverage.historyComplete)],
    ["last_fetched_at", data.coverage.lastFetchedAt],
    ["missing_publication_dates", data.coverage.missingPublicationDateCount],
    [
      "unavailable_values",
      "Blank cells are unmeasured/unsupported, never zero.",
    ],
    [
      "rate_formula",
      "100 × measured numerator / exposure; only posts with complete required counters and positive exposure.",
    ],
    [
      "reach",
      "Views/impressions are not deduplicated unique viewers or interchangeable across networks.",
    ],
    [
      "snapshots",
      "Observed daily counters from collection start; not backfilled event-time analytics.",
    ],
  ];
  if (workspaceExport)
    metadata.push(
      ["workspace_id", data.workspaceId],
      [
        "duplicate_post_copies_excluded",
        data.coverage.duplicatePostCopiesExcluded,
      ],
      [
        "workspace_post_deduplication",
        "Provider + external post ID, freshest measured copy; account and project comparisons overlap and cannot be added.",
      ],
      [
        "missing_publication_dates_basis",
        "Cached connection copies missing publication dates; excluded from cohorts.",
      ],
    );
  for (const rate of data.summary.current.engagementRates)
    metadata.push([
      `${rate.provider}_rate`,
      `100 × (${rate.numeratorMetrics.join(" + ")}) / ${rate.denominator}`,
    ]);
  const trends: Cell[][] = [
    ["publication_date", "posts", ...METRICS, "interactions", "basis"],
  ];
  for (const point of data.daily)
    trends.push([
      point.date,
      point.summary.postCount,
      ...METRICS.map((key) => point.summary.metrics[key].total),
      point.summary.interactions.total,
      data.range.semantics,
    ]);
  const followers: Cell[][] = [
    [
      "platform",
      "account_id",
      "observation_date",
      "measured_at",
      "followers_or_subscribers",
    ],
  ];
  for (const account of data.followers)
    for (const point of account.points)
      followers.push([
        account.provider,
        account.connectionId,
        point.date,
        point.fetchedAt,
        point.value,
      ]);
  const accounts: Cell[][] = [
    [
      "platform",
      "account_id",
      "handle",
      ...projectColumns,
      "metric",
      "value",
      "period",
      "unit",
      "measured_at",
      "history_complete",
      "history_error",
      "metric_warning",
    ],
  ];
  for (const account of data.accounts)
    for (const metric of account.statistics?.metrics ?? [])
      accounts.push([
        account.provider,
        account.id,
        account.externalHandle,
        ...attribution(account.id),
        metric.key,
        metric.value,
        metric.period,
        metric.unit,
        account.statistics?.fetchedAt ?? null,
        String(account.statistics?.historyComplete ?? false),
        account.statistics?.historyError ?? null,
        account.statistics?.metricWarning ?? null,
      ]);
  const sheets = [
    { name: "Posts", rows: posts },
    { name: "Definitions", rows: metadata },
    { name: "Publication trends", rows: trends },
    { name: "Follower observations", rows: followers },
    { name: "Account metrics", rows: accounts },
  ];
  if (workspaceExport) {
    const rows: Cell[][] = [
      ["project_id", "project_name", "posts", ...METRICS, "interactions"],
    ];
    for (const comparison of data.comparisons.projects)
      rows.push([
        comparison.projectId,
        projects.find((project) => project.id === comparison.projectId)?.name ??
          null,
        comparison.summary.postCount,
        ...METRICS.map((metric) => comparison.summary.metrics[metric].total),
        comparison.summary.interactions.total,
      ]);
    sheets.push({ name: "Projects", rows });
  }
  return sheets;
}

/** Preserve loaded pages and their sample coverage; never imply a complete audience or deduplicate page evidence. */
export function socialPerformanceAudienceExportSheets(
  connectionId: string,
  pages: AudiencePage[],
): ExportSheet[] {
  const provenance = [
    "account_id",
    "page_index",
    "kind",
    "post_id",
    "observed_at",
    "sample_post_count",
    "page_contact_count",
    "oldest_post_at",
    "newest_post_at",
    "next_cursor",
    "coverage",
  ];
  const contacts: Cell[][] = [
    [
      "row_type",
      ...provenance,
      "contact_id",
      "name",
      "username",
      "description",
      "location",
      "avatar_url",
      "followers_count",
      "interactions",
      "replies",
      "quotes",
      "mentions",
      "likes",
      "reposts",
    ],
  ];
  const coverage: Cell[][] = [
    [...provenance, "page_incoming_post_count", "source"],
  ];
  const incoming: Cell[][] = [
    [
      ...provenance,
      "incoming_post_id",
      "interaction_type",
      "author_id",
      "author_name",
      "author_username",
      "published_at",
      "text",
      "url",
      "content_type",
      "post_kind",
      ...METRICS,
      "quote_count",
      "measured_at",
    ],
  ];
  pages.forEach((page, index) => {
    const metadata: Cell[] = [
      connectionId,
      index + 1,
      page.kind,
      page.postId,
      page.observedAt,
      page.samplePostCount,
      page.contacts.length,
      page.oldestPostAt,
      page.newestPostAt,
      page.nextCursor,
      page.coverage,
    ];
    coverage.push([...metadata, page.posts.length, "loaded_client_sample"]);
    // An empty CSV page retains its coverage without claiming a measured contact.
    const rows = page.contacts.length ? page.contacts : [null];
    for (const contact of rows) {
      contacts.push([
        contact ? "contact" : "page_coverage",
        ...metadata,
        contact?.id ?? null,
        contact?.name ?? null,
        contact?.username ?? null,
        contact?.description ?? null,
        contact?.location ?? null,
        contact?.avatarUrl ?? null,
        contact?.followersCount ?? null,
        contact?.interactions ?? null,
        contact?.replies ?? null,
        contact?.quotes ?? null,
        contact?.mentions ?? null,
        contact?.likes ?? null,
        contact?.reposts ?? null,
      ]);
    }
    for (const evidence of page.posts) {
      incoming.push([
        ...metadata,
        evidence.post.externalId,
        evidence.interactionType,
        evidence.author?.id ?? null,
        evidence.author?.name ?? null,
        evidence.author?.username ?? null,
        evidence.post.publishedAt,
        evidence.post.text,
        evidence.post.url,
        evidence.post.contentType,
        evidence.post.postKind,
        ...METRICS.map((key) => evidence.post.metrics[key]),
        evidence.post.additionalMetrics.find(
          (metric) => metric.key === "quote_count",
        )?.value ?? null,
        evidence.post.fetchedAt,
      ]);
    }
  });
  return [
    { name: "Contacts", rows: contacts },
    { name: "Coverage", rows: coverage },
    { name: "Incoming posts", rows: incoming },
  ];
}

export function socialPerformanceCsv(rows: Cell[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) =>
            csvField(
              typeof value === "string"
                ? csvLabel(value)
                : value === null
                  ? ""
                  : String(value),
            ),
          )
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function column(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

/** Minimal native OOXML with numeric cells and explicit inline strings; uses installed JSZip. */
export async function socialPerformanceXlsx(
  sheets: ExportSheet[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  zip.file(
    "[Content_Types].xml",
    declaration +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    declaration +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      "</sheets></workbook>",
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      "</Relationships>",
  );
  sheets.forEach((sheet, i) =>
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      declaration +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        sheet.rows
          .map(
            (row, j) =>
              `<row r="${j + 1}">` +
              row
                .map((value, k) =>
                  value === null
                    ? ""
                    : typeof value === "number"
                      ? `<c r="${column(k)}${j + 1}"><v>${value}</v></c>`
                      : `<c r="${column(k)}${j + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
                )
                .join("") +
              "</row>",
          )
          .join("") +
        "</sheetData></worksheet>",
    ),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
