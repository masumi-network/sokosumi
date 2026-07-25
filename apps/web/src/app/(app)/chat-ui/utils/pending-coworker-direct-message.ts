import { slugify } from "@/app/chat/utils/bucket-slug";

const PENDING_COWORKER_DIRECT_MESSAGE_STORAGE_KEY =
  "sokosumi:pending-coworker-direct-message";

export const PENDING_COWORKER_DIRECT_MESSAGE_MAX_AGE_MS = 2 * 60 * 1000;

export interface PendingCoworkerDirectMessage {
  coworkerId: string;
  coworkerSlug: string;
  content: string;
  createdAt: number;
}

export function writePendingCoworkerDirectMessage(
  message: PendingCoworkerDirectMessage,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      PENDING_COWORKER_DIRECT_MESSAGE_STORAGE_KEY,
      JSON.stringify(message),
    );
  } catch {
    // Ignore storage failures; user still lands in the coworker chat.
  }
}

export function readPendingCoworkerDirectMessage(): PendingCoworkerDirectMessage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(
      PENDING_COWORKER_DIRECT_MESSAGE_STORAGE_KEY,
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingCoworkerDirectMessage>;
    if (
      typeof parsed.coworkerId !== "string" ||
      typeof parsed.coworkerSlug !== "string" ||
      typeof parsed.content !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }

    return {
      coworkerId: parsed.coworkerId,
      coworkerSlug: parsed.coworkerSlug,
      content: parsed.content,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearPendingCoworkerDirectMessage(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(
      PENDING_COWORKER_DIRECT_MESSAGE_STORAGE_KEY,
    );
  } catch {
    // ignore
  }
}

export function isPendingCoworkerDirectMessageFresh(
  message: PendingCoworkerDirectMessage,
  now = Date.now(),
): boolean {
  return now - message.createdAt <= PENDING_COWORKER_DIRECT_MESSAGE_MAX_AGE_MS;
}

export function pendingCoworkerDirectMessageMatchesBucket(
  message: PendingCoworkerDirectMessage,
  {
    bucketKey,
    bucketSlug,
  }: {
    bucketKey?: string | null;
    bucketSlug?: string | null;
  },
): boolean {
  if (bucketKey) {
    if (
      bucketKey === `coworker:${message.coworkerSlug}` ||
      bucketKey === `coworker:${message.coworkerId}`
    ) {
      return true;
    }
  }

  const normalizedBucketSlug = slugify(bucketSlug ?? "");
  if (!normalizedBucketSlug) {
    return false;
  }

  return (
    slugify(message.coworkerSlug) === normalizedBucketSlug ||
    slugify(message.coworkerId) === normalizedBucketSlug
  );
}
