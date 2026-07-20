import type { HermesPersistedMessage } from "@/lib/hermes/types";

import type { Message } from "./types";

export function persistedToMessage(m: HermesPersistedMessage): Message | null {
  if (m.role !== "user" && m.role !== "assistant") return null;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    kind: m.kind,
    steps: m.steps,
    durationMs: m.durationMs,
    createdAt: m.createdAt,
  };
}

export function persistedToMessages(
  messages: HermesPersistedMessage[],
): Message[] {
  return messages
    .map(persistedToMessage)
    .filter((m): m is Message => m !== null);
}

export function hasSameMessageIds(left: Message[], right: Message[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.id !== right[i]!.id) return false;
  }
  return true;
}

/** Stable-ish key for a turn's duration, surviving the temp→persisted id swap
 * on the post-turn DB re-sync (the content text is unchanged). */
export function durationKey(content: string): string {
  return content.trim().slice(0, 80);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("file_read_failed"));
    r.readAsDataURL(file);
  });
}

/** Prefer the data URL MIME when the browser left `File.type` blank. */
export function mimeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]*);/i.exec(dataUrl);
  if (!match) return null;
  const raw = match[1]!.trim();
  const lower = raw.toLowerCase();
  if (lower === "" || lower === "application/octet-stream") return null;
  return lower;
}

export function clientMimeForHermesUpload(file: File, dataUrl: string): string {
  if (file.type.trim() !== "") return file.type;
  return mimeFromDataUrl(dataUrl) ?? "application/octet-stream";
}
