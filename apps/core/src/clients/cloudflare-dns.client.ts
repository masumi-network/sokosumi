const CLOUDFLARE_API_URL = "https://api.cloudflare.com/client/v4";
/** "Record already exists" and "identical record already exists". */
const RECORD_EXISTS_CODES = new Set([81057, 81058]);

export interface CloudflareZone {
  id: string;
  name: string;
}

export interface CloudflareDnsRecordInput {
  type: string;
  name: string;
  content: string;
  priority?: number;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

/** A Cloudflare refusal. The message never contains the API token. */
export class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    readonly codes: number[],
  ) {
    super(
      `Cloudflare API request failed with HTTP ${status}${codes.length ? ` (codes ${codes.join(", ")})` : ""}`,
    );
    this.name = "CloudflareApiError";
  }
}

export interface CloudflareDnsClient {
  listZones(name: string): Promise<CloudflareZone[]>;
  /** Resolves `false` when an identical record already exists. */
  createDnsRecord(
    zoneId: string,
    record: CloudflareDnsRecordInput,
  ): Promise<boolean>;
}

/**
 * A client bound to one user-supplied API token for a single request. The
 * token lives only in this closure: it is never stored, logged, or put into an
 * error.
 */
export function cloudflareDnsClient(apiToken: string): CloudflareDnsClient {
  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: CloudflareEnvelope<T> | null }> {
    const response = await fetch(`${CLOUDFLARE_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response
      .json()
      .catch(() => null)) as CloudflareEnvelope<T> | null;
    return { status: response.status, body };
  }

  function codes(body: CloudflareEnvelope<unknown> | null): number[] {
    return body?.errors?.map((error) => error.code) ?? [];
  }

  return {
    async listZones(name) {
      const { status, body } = await request<CloudflareZone[]>(
        `/zones?${new URLSearchParams({ name, status: "active" })}`,
      );
      if (!body?.success) throw new CloudflareApiError(status, codes(body));
      return body.result.map(({ id, name }) => ({ id, name }));
    },
    async createDnsRecord(zoneId, record) {
      const { status, body } = await request(
        `/zones/${encodeURIComponent(zoneId)}/dns_records`,
        {
          method: "POST",
          body: JSON.stringify({
            ...record,
            ttl: 1,
            // A proxied DKIM CNAME would hide the key from mail servers.
            ...(record.type === "CNAME" ? { proxied: false } : {}),
          }),
        },
      );
      if (body?.success) return true;
      const errorCodes = codes(body);
      if (errorCodes.some((code) => RECORD_EXISTS_CODES.has(code))) {
        return false;
      }
      throw new CloudflareApiError(status, errorCodes);
    },
  };
}
