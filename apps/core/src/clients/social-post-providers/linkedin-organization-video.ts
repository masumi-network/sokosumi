import { ssrfSafeFetch } from "@sokosumi/net";
import type { SocialPostMediaRef } from "@sokosumi/utils";
import { socialPostProviderLabel } from "@sokosumi/utils";

import { ComposioApiError, record } from "@/clients/composio.client";
import {
  LINKEDIN_REST_BASE_URL,
  LINKEDIN_REST_HEADERS,
} from "@/clients/social-post-providers/linkedin-organizations";
import {
  type ComposioProxyResult,
  ComposioToolError,
  executeComposioProxy,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import { downloadSocialPostMedia } from "@/helpers/social-post-media";

const PROCESSING_TIMEOUT_MS = 120_000;
const PROCESSING_POLL_MS = 3_000;

interface OrganizationVideoInput {
  connectedAccountId: string;
  /** `urn:li:organization:<id>`. */
  author: string;
  text: string;
  video: SocialPostMediaRef;
  signal?: AbortSignal;
}

function refused(message: string, result: ComposioProxyResult): never {
  throw new ComposioToolError({
    message,
    providerMessage:
      typeof result.data?.message === "string" ? result.data.message : null,
    providerStatus: result.status,
  });
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Uploads every part LinkedIn asked for and returns their ETags in order. */
async function uploadVideoParts(
  bytes: Uint8Array<ArrayBuffer>,
  instructions: unknown[],
  signal?: AbortSignal,
): Promise<string[]> {
  const etags: string[] = [];
  for (const entry of instructions) {
    const instruction = record(entry);
    const uploadUrl = instruction?.uploadUrl;
    const firstByte = instruction?.firstByte;
    const lastByte = instruction?.lastByte;
    if (
      typeof uploadUrl !== "string" ||
      typeof firstByte !== "number" ||
      typeof lastByte !== "number"
    ) {
      throw new ComposioToolError({
        message: "LinkedIn video upload returned no upload instructions",
      });
    }
    const uploaded = await ssrfSafeFetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes.slice(firstByte, lastByte + 1),
      maxResponseBytes: 64 * 1024,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    });
    const etag = uploaded.headers.get("etag");
    if (!uploaded.ok || !etag) {
      throw new ComposioApiError(
        uploaded.ok ? 502 : uploaded.status,
        undefined,
        "Could not upload LinkedIn video",
      );
    }
    etags.push(etag);
  }
  return etags;
}

async function waitUntilVideoAvailable(
  input: OrganizationVideoInput,
  videoUrn: string,
): Promise<void> {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  for (;;) {
    const video = await executeComposioProxy({
      connectedAccountId: input.connectedAccountId,
      endpoint: `${LINKEDIN_REST_BASE_URL}/videos/${encodeURIComponent(videoUrn)}`,
      method: "GET",
      parameters: LINKEDIN_REST_HEADERS,
      context: "read LinkedIn video status",
      signal: input.signal,
    });
    if (video.status !== 200) refused("LinkedIn refused the video", video);
    const status = video.data?.status;
    if (status === "AVAILABLE") return;
    if (status === "PROCESSING_FAILED") {
      throw new ComposioToolError({
        message: "LinkedIn could not process the video",
      });
    }
    if (Date.now() + PROCESSING_POLL_MS > deadline) {
      throw new ComposioToolError({
        message: "LinkedIn did not finish processing the video in time",
      });
    }
    await wait(PROCESSING_POLL_MS, input.signal);
  }
}

/**
 * Publishes a video post as a company page. Composio's video tools only post
 * as the member, so this drives LinkedIn's Videos and Posts APIs through the
 * Composio proxy. Returns the post URN, or null when LinkedIn sent none.
 */
export async function publishLinkedInOrganizationVideoPost(
  input: OrganizationVideoInput,
): Promise<string | null> {
  const [file] = await downloadSocialPostMedia(
    "linkedin",
    [input.video],
    input.signal,
  );
  const initialized = await executeComposioProxy({
    connectedAccountId: input.connectedAccountId,
    endpoint: `${LINKEDIN_REST_BASE_URL}/videos`,
    method: "POST",
    parameters: [
      ...LINKEDIN_REST_HEADERS,
      { name: "action", value: "initializeUpload", type: "query" },
    ],
    body: {
      initializeUploadRequest: {
        owner: input.author,
        fileSizeBytes: file.bytes.byteLength,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    },
    context: "start LinkedIn video upload",
    signal: input.signal,
  });
  if (initialized.status !== 200)
    refused("LinkedIn refused the video upload", initialized);
  const value = record(initialized.data?.value);
  const videoUrn = typeof value?.video === "string" ? value.video : null;
  const instructions = value?.uploadInstructions;
  if (!videoUrn || !Array.isArray(instructions) || instructions.length === 0) {
    throw new ComposioToolError({
      message: "LinkedIn video upload returned no video",
    });
  }

  const uploadedPartIds = await uploadVideoParts(
    file.bytes,
    instructions,
    input.signal,
  );
  const finalized = await executeComposioProxy({
    connectedAccountId: input.connectedAccountId,
    endpoint: `${LINKEDIN_REST_BASE_URL}/videos`,
    method: "POST",
    parameters: [
      ...LINKEDIN_REST_HEADERS,
      { name: "action", value: "finalizeUpload", type: "query" },
    ],
    body: {
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken:
          typeof value?.uploadToken === "string" ? value.uploadToken : "",
        uploadedPartIds,
      },
    },
    context: "finish LinkedIn video upload",
    signal: input.signal,
  });
  if (finalized.status < 200 || finalized.status > 299)
    refused("LinkedIn refused the video upload", finalized);
  await waitUntilVideoAvailable(input, videoUrn);

  const post = await guardSocialCreateOutcome(
    socialPostProviderLabel("linkedin"),
    async () => {
      const created = await executeComposioProxy({
        connectedAccountId: input.connectedAccountId,
        endpoint: `${LINKEDIN_REST_BASE_URL}/posts`,
        method: "POST",
        parameters: LINKEDIN_REST_HEADERS,
        body: {
          author: input.author,
          commentary: input.text,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          content: { media: { id: videoUrn } },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
        context: "publish LinkedIn video post",
        signal: input.signal,
      });
      if (created.status < 200 || created.status > 299)
        refused("LinkedIn refused the post", created);
      return created;
    },
  );
  const id = post.headers["x-restli-id"] ?? post.data?.id;
  return typeof id === "string" && id ? id : null;
}
