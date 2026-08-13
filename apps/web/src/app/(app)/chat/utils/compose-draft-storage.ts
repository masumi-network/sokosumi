export interface ComposeDraftAttachment {
  url: string;
  fileName: string;
  mediaType?: string;
}

export interface ComposeDraft {
  text: string;
  attachments: ComposeDraftAttachment[];
}

const DRAFT_KEY_PREFIX = "sokosumi:compose-draft:v1:";

export const EMPTY_COMPOSE_DRAFT: ComposeDraft = {
  text: "",
  attachments: [],
};

export const composeDraftKey = {
  room(id: string): string {
    return `${DRAFT_KEY_PREFIX}room:${id}`;
  },
  thread(roomId: string, parentId: string): string {
    return `${DRAFT_KEY_PREFIX}thread:${roomId}:${parentId}`;
  },
  draftDm(): string {
    return `${DRAFT_KEY_PREFIX}draft-dm`;
  },
};

function isComposeDraftAttachment(
  value: unknown,
): value is ComposeDraftAttachment {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const attachment = value as ComposeDraftAttachment;
  if (typeof attachment.url !== "string") {
    return false;
  }
  if (typeof attachment.fileName !== "string") {
    return false;
  }
  if (
    attachment.mediaType !== undefined &&
    typeof attachment.mediaType !== "string"
  ) {
    return false;
  }
  return true;
}

function parseComposeDraft(raw: string): ComposeDraft | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") {
      return null;
    }
    const draft = parsed as ComposeDraft;
    if (typeof draft.text !== "string") {
      return null;
    }
    if (!Array.isArray(draft.attachments)) {
      return null;
    }
    if (!draft.attachments.every(isComposeDraftAttachment)) {
      return null;
    }
    return {
      text: draft.text,
      attachments: draft.attachments.map((attachment) => ({
        url: attachment.url,
        fileName: attachment.fileName,
        ...(attachment.mediaType !== undefined
          ? { mediaType: attachment.mediaType }
          : {}),
      })),
    };
  } catch {
    return null;
  }
}

function isEmptyComposeDraft(draft: ComposeDraft): boolean {
  return draft.text.trim().length === 0 && draft.attachments.length === 0;
}

export function getComposeDraft(key: string): ComposeDraft | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      return null;
    }
    return parseComposeDraft(raw);
  } catch {
    return null;
  }
}

export function setComposeDraft(key: string, draft: ComposeDraft): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    if (isEmptyComposeDraft(draft)) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        text: draft.text,
        attachments: draft.attachments,
      }),
    );
  } catch {
    // Best-effort: quota / private mode must not break compose.
  }
}

export function clearComposeDraft(key: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(key);
  } catch {
    // Quota / private mode — compose must keep working.
  }
}
