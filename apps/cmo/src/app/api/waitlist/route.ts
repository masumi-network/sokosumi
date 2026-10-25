/**
 * The landing page's waitlist (public/site): each signup becomes a row in the
 * "CMO.xyz Waiting List" table on Sokosumi (utxo organization). Ported from
 * the cmo-website repo's `api/waitlist.js`; `SOKOSUMI_API_KEY` is a Sokosumi
 * API key with access to that table and never reaches the browser.
 */

const API = "https://api.sokosumi.com/v1";
const ORG_SLUG = "utxo";
const TABLE_ID = "01a111e2-9c09-7180-9552-44161a45e89d";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;

/** Column ids by name, read once per warm instance. */
let columnIds: Record<string, string> | null = null;

class SokosumiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Sokosumi ${status}`);
  }
}

async function soko<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SOKOSUMI_API_KEY}`,
      "X-Organization-Slug": ORG_SLUG,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new SokosumiError(response.status, body);
  return body as T;
}

async function getColumnIds(): Promise<Record<string, string>> {
  if (columnIds) return columnIds;
  const table = await soko<{
    data: { columns?: { id: string; name: string }[] };
  }>(`/drive/tables/${TABLE_ID}`);
  const ids = Object.fromEntries(
    (table.data.columns ?? []).map((column) => [column.name, column.id]),
  );
  if (!ids.Email) throw new Error('Waitlist table has no "Email" column');
  columnIds = ids;
  return ids;
}

/** Optional; "acme.com" gains https://. Null when it is not a real domain. */
export function normalizeWebsite(website: string): string | null {
  if (!website) return "";
  const url = /^https?:\/\//i.test(website)
    ? website
    : `https://${website.replace(/^\/+/, "")}`;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return DOMAIN.test(host) ? url : null;
}

function reply(status: number, body: object): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  let email = "";
  let website = "";
  try {
    const data = (await request.json()) as {
      email?: unknown;
      website?: unknown;
    };
    email = String(data.email ?? "").trim();
    website = String(data.website ?? "").trim();
  } catch {
    // An empty or broken body fails the email check below.
  }

  if (!EMAIL.test(email)) {
    return reply(400, { error: "Please enter a valid email." });
  }
  const site = normalizeWebsite(website);
  if (site === null) {
    return reply(400, {
      error: "Please enter a valid website, or leave it blank.",
    });
  }

  if (!process.env.SOKOSUMI_API_KEY) {
    // As on the old site: the log keeps the signup so it can be added later.
    console.error(
      "waitlist: SOKOSUMI_API_KEY is not set; signup not saved:",
      email,
    );
    return reply(503, {
      error: "Signups are paused for a moment. Please try again soon.",
    });
  }

  try {
    const columns = await getColumnIds();
    const values: Record<string, string> = { [columns.Email as string]: email };
    if (columns.URL && site) values[columns.URL] = site;
    await soko(`/drive/tables/${TABLE_ID}/rows`, {
      method: "POST",
      body: JSON.stringify({
        key: `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        insert: [{ values }],
      }),
    });
    return reply(200, { ok: true });
  } catch (error) {
    // Read the columns again next time, in case the table changed.
    columnIds = null;
    console.error(
      "waitlist save failed:",
      error instanceof SokosumiError
        ? `${error.status} ${JSON.stringify(error.body)}`
        : error instanceof Error
          ? error.message
          : "unknown",
    );
    return reply(502, {
      error: "Could not save your signup. Please try again.",
    });
  }
}
