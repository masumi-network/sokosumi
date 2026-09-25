import { getEnv } from "@/config/env";

/**
 * The fal queue protocol, and nothing else.
 *
 * Everything here is transport. No database, no authorization, no policy — so
 * the service above can be read as "what we do about what fal said" without
 * also holding the shape of fal's API in mind.
 *
 * Reference: https://fal.ai/docs/model-endpoints/queue
 */

const QUEUE_ORIGIN = "https://queue.fal.run";
const STORAGE_INITIATE_URL =
  "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

/** Text to image. Verified 2026-09-25: takes no reference image. */
export const IMAGE_MODEL_GENERATE = "fal-ai/gemini-3.1-flash-image-preview";
/** Image to image. Verified 2026-09-25: takes `image_urls`. */
export const IMAGE_MODEL_EDIT = "fal-ai/gemini-3.1-flash-image-preview/edit";

const SUBMIT_TIMEOUT_MS = 20_000;
const STATUS_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * What we learned from trying to submit.
 *
 * The three cases are not three flavours of failure — they are three different
 * facts about whether money may have been spent, and the caller must treat
 * them differently. `uncertain` is the one that matters: it means a retry could
 * buy a second image.
 */
export type FalSubmitOutcome =
  | { kind: "queued"; requestId: string }
  /** fal answered and refused. Nothing was enqueued; retrying is free. */
  | { kind: "rejected"; status: number; message: string }
  /** No usable answer. The request may or may not be in the queue. */
  | { kind: "uncertain"; message: string };

export type FalStatus =
  | { kind: "in_queue"; queuePosition: number | null }
  | { kind: "in_progress" }
  | { kind: "completed" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export interface FalImage {
  url: string;
  width: number | null;
  height: number | null;
  contentType: string | null;
}

export interface FalGenerationInput {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  seed: number | null;
  /** Provider-hosted URLs only. Never one of our own asset URLs. */
  imageUrls: string[];
}

function requireKey(): string {
  const key = getEnv().FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured");
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Key ${requireKey()}`,
    "content-type": "application/json",
  };
}

export function falModelForKind(kind: "GENERATE" | "EDIT"): string {
  return kind === "EDIT" ? IMAGE_MODEL_EDIT : IMAGE_MODEL_GENERATE;
}

/**
 * The id the queue's per-request routes are mounted under.
 *
 * A model id is `owner/app`; anything after that is a sub-path selecting a
 * variant, such as `/edit`. Submission goes to the full path, but status,
 * result and cancel live under `owner/app` only — asking for them under the
 * sub-path answers 405. fal's own submit response says the same thing in its
 * `status_url`, which always drops the variant.
 *
 * Verified against the live queue on 2026-09-25: polling
 * `…/gemini-3.1-flash-image-preview/edit/requests/{id}/status` returns 405,
 * while `…/gemini-3.1-flash-image-preview/requests/{id}/status` returns the
 * request. Getting this wrong makes every refinement look like a failure.
 */
export function queueRequestModel(model: string): string {
  const segments = model.split("/");
  return segments.length > 2 ? segments.slice(0, 2).join("/") : model;
}

export function buildFalInput(
  input: FalGenerationInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    output_format: input.outputFormat,
    num_images: 1,
  };
  if (input.seed !== null) body.seed = input.seed;
  // Only the `/edit` endpoint accepts this field. Sending it to the base
  // endpoint would be silently ignored, which is exactly how a refinement
  // turns into an unrelated fresh image, so the caller picks the endpoint from
  // the same fact that fills this array.
  if (input.imageUrls.length > 0) body.image_urls = input.imageUrls;
  return body;
}

/**
 * Submit one request to the queue.
 *
 * `webhookUrl` is optional because it only works from a host fal can reach.
 * Without it the job settles through polling, which is what local development
 * and preview deployments actually do.
 */
export async function submitToQueue(options: {
  model: string;
  input: Record<string, unknown>;
  webhookUrl: string | null;
}): Promise<FalSubmitOutcome> {
  const url = new URL(`${QUEUE_ORIGIN}/${options.model}`);
  if (options.webhookUrl)
    url.searchParams.set("fal_webhook", options.webhookUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(),
        // fal retries a failed runner up to 10 times on its own. That is fine
        // and is not a second charge; what we must not do is submit twice.
        "x-fal-request-timeout": "300",
      },
      body: JSON.stringify(options.input),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    // Timed out, aborted, DNS, socket reset. The request may be sitting in
    // fal's queue right now and we will never know from here.
    return {
      kind: "uncertain",
      message: error instanceof Error ? error.message : "submission failed",
    };
  }

  if (response.status >= 500) {
    // A gateway 5xx can mean "rejected before enqueue" or "enqueued, then the
    // response was lost". Both look identical from here, so it is uncertain.
    return {
      kind: "uncertain",
      message: `fal returned ${response.status}`,
    };
  }

  if (!response.ok) {
    return {
      kind: "rejected",
      status: response.status,
      message: await readErrorMessage(response),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // 2xx with an unreadable body: fal almost certainly accepted it.
    return { kind: "uncertain", message: "fal returned an unreadable body" };
  }

  const requestId =
    typeof body === "object" && body !== null && "request_id" in body
      ? (body as { request_id?: unknown }).request_id
      : undefined;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { kind: "uncertain", message: "fal returned no request id" };
  }
  return { kind: "queued", requestId };
}

/** Bounded, quiet read of a provider error body. Never surfaces the key. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 500);
    return text.length > 0 ? text : `fal returned ${response.status}`;
  } catch {
    return `fal returned ${response.status}`;
  }
}

export async function fetchQueueStatus(options: {
  model: string;
  requestId: string;
}): Promise<FalStatus> {
  const url = `${QUEUE_ORIGIN}/${queueRequestModel(options.model)}/requests/${encodeURIComponent(options.requestId)}/status`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "status read failed",
    };
  }
  if (response.status === 404) return { kind: "not_found" };
  if (!response.ok) {
    return { kind: "error", message: await readErrorMessage(response) };
  }
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    queue_position?: number;
  } | null;
  switch (body?.status) {
    case "IN_QUEUE":
      return {
        kind: "in_queue",
        queuePosition:
          typeof body.queue_position === "number" ? body.queue_position : null,
      };
    case "IN_PROGRESS":
      return { kind: "in_progress" };
    case "COMPLETED":
      return { kind: "completed" };
    default:
      return { kind: "error", message: "fal returned an unknown status" };
  }
}

/**
 * Read a completed request's payload.
 *
 * Returns `null` when the request is not finished, which the caller treats as
 * "keep waiting" rather than as a failure.
 */
export async function fetchQueueResult(options: {
  model: string;
  requestId: string;
}): Promise<
  | { kind: "images"; images: FalImage[] }
  | { kind: "pending" }
  | { kind: "error"; message: string }
> {
  const url = `${QUEUE_ORIGIN}/${queueRequestModel(options.model)}/requests/${encodeURIComponent(options.requestId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "result read failed",
    };
  }
  if (response.status === 202 || response.status === 404) {
    return { kind: "pending" };
  }
  if (!response.ok) {
    return { kind: "error", message: await readErrorMessage(response) };
  }
  const body = await response.json().catch(() => null);
  const images = parseImages(body);
  if (images.length === 0) {
    return { kind: "error", message: "fal returned no image" };
  }
  return { kind: "images", images };
}

/** Reads the `images[]` array out of a payload without trusting its shape. */
export function parseImages(payload: unknown): FalImage[] {
  if (typeof payload !== "object" || payload === null) return [];
  const raw = (payload as { images?: unknown }).images;
  if (!Array.isArray(raw)) return [];
  const images: FalImage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const {
      url,
      width,
      height,
      content_type: contentType,
    } = entry as Record<string, unknown>;
    if (typeof url !== "string" || url.length === 0) continue;
    images.push({
      url,
      width: typeof width === "number" ? width : null,
      height: typeof height === "number" ? height : null,
      contentType: typeof contentType === "string" ? contentType : null,
    });
  }
  return images;
}

export async function cancelQueued(options: {
  model: string;
  requestId: string;
}): Promise<"accepted" | "already_finished" | "unknown"> {
  const url = `${QUEUE_ORIGIN}/${queueRequestModel(options.model)}/requests/${encodeURIComponent(options.requestId)}/cancel`;
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: authHeaders(),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (response.status === 202) return "accepted";
    if (response.status === 400) return "already_finished";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Put reference bytes in fal's own storage and return the URL fal should read.
 *
 * This exists so a reference image never requires a publicly readable URL on
 * our side. Our originals stay in private storage; the provider gets its own
 * copy, on its own CDN, for as long as it keeps it.
 */
export async function uploadReference(options: {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}): Promise<string> {
  const initiate = await fetch(STORAGE_INITIATE_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      content_type: options.contentType,
      file_name: options.fileName,
    }),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!initiate.ok) {
    throw new Error(`fal storage initiate failed (${initiate.status})`);
  }
  const body = (await initiate.json()) as {
    file_url?: unknown;
    upload_url?: unknown;
  };
  if (
    typeof body.file_url !== "string" ||
    typeof body.upload_url !== "string"
  ) {
    throw new Error("fal storage initiate returned an unusable response");
  }

  const upload = await fetch(body.upload_url, {
    method: "PUT",
    headers: { "content-type": options.contentType },
    body: options.bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!upload.ok) {
    throw new Error(`fal storage upload failed (${upload.status})`);
  }
  return body.file_url;
}

/** Download a generated image, refusing anything larger than `maxBytes`. */
export async function downloadImage(
  url: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`image download failed (${response.status})`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new Error(`image is larger than ${maxBytes} bytes`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  // `content-length` is a claim; the body is the fact.
  if (buffer.byteLength > maxBytes) {
    throw new Error(`image is larger than ${maxBytes} bytes`);
  }
  return {
    bytes: buffer,
    contentType: response.headers.get("content-type") ?? "image/png",
  };
}
