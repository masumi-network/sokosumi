export interface HermesUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind: string | null;
  createdAt: string;
}

const LOCAL_MESSAGE_ID_PATTERN = /^(u|a)-/;
const TURN_MATCH_WINDOW_MS = 30_000;
const FILE_NOTE_PATTERN = /(?:\n\n)?(?:📎|Attached files:)\s+.+$/u;

function parseCreatedAtMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeUserContentForCompare(content: string): string {
  return content.trim().replace(FILE_NOTE_PATTERN, "").trim();
}

function isLocalMessage(message: HermesUiMessage): boolean {
  return LOCAL_MESSAGE_ID_PATTERN.test(message.id);
}

function hasServerUserCoveringLocal(
  local: HermesUiMessage,
  server: HermesUiMessage[],
): boolean {
  const localMs = parseCreatedAtMs(local.createdAt);
  const thresholdMs = localMs - TURN_MATCH_WINDOW_MS;
  const normalizedLocal = normalizeUserContentForCompare(local.content);

  for (const message of server) {
    if (message.role !== "user") continue;

    const serverMs = parseCreatedAtMs(message.createdAt);
    if (serverMs < thresholdMs) continue;

    if (
      Math.abs(serverMs - localMs) <= TURN_MATCH_WINDOW_MS &&
      normalizeUserContentForCompare(message.content) === normalizedLocal
    ) {
      return true;
    }

    return true;
  }

  return false;
}

function hasServerAssistantCoveringLocal(
  local: HermesUiMessage,
  server: HermesUiMessage[],
): boolean {
  const thresholdMs = parseCreatedAtMs(local.createdAt) - TURN_MATCH_WINDOW_MS;
  return server.some(
    (message) =>
      message.role === "assistant" &&
      parseCreatedAtMs(message.createdAt) >= thresholdMs,
  );
}

function shouldKeepLocalMessage(
  local: HermesUiMessage,
  server: HermesUiMessage[],
): boolean {
  if (local.role === "user") return !hasServerUserCoveringLocal(local, server);
  return !hasServerAssistantCoveringLocal(local, server);
}

export function mergeHermesMessageLists(
  previous: HermesUiMessage[],
  server: HermesUiMessage[],
): HermesUiMessage[] {
  const merged = [...server];
  const seenIds = new Set(server.map((message) => message.id));

  for (const message of previous) {
    if (!isLocalMessage(message) || seenIds.has(message.id)) continue;
    if (!shouldKeepLocalMessage(message, server)) continue;

    merged.push(message);
    seenIds.add(message.id);
  }

  return merged;
}
