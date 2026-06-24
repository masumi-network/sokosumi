export interface HermesUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind: string | null;
  /** Turn trace captured during a streamed turn — `tool` action steps and
   * `reasoning` beats, in order — persisted so the disclosure survives a
   * reload. Absent for non-streamed turns. */
  steps?: { kind?: "tool" | "reasoning"; label: string; detail?: string }[];
  /** Total wall-clock time of the streamed turn (ms), persisted so the
   * "Answered in Ns" stamp survives a reload. */
  durationMs?: number;
  createdAt: string;
}

const LOCAL_MESSAGE_ID_PATTERN = /^(u|a)-/;
const FILE_NOTE_PATTERN = /(?:\n\n)?(?:📎|Attached files:)\s+.+$/u;

function normalizeUserContentForCompare(content: string): string {
  return content.trim().replace(FILE_NOTE_PATTERN, "").trim();
}

function isLocalMessage(message: HermesUiMessage): boolean {
  return LOCAL_MESSAGE_ID_PATTERN.test(message.id);
}

// Reconcile optimistic local messages against persisted server rows by CONTENT,
// not a time window. A time-proximity heuristic wrongly treats the previous
// turn's reply as "covering" a rapid follow-up — dropping the new message until
// the next poll re-adds it, which the user sees as the answer flickering out and
// back. Matching keeps the local message until its own server row lands (Core
// persists user+assistant atomically), then swaps seamlessly.
//
// Matching is one-for-one (a multiset), NOT "any server row with this content":
// if the user sends the same text twice ("yes", "yes"), two local rows must map
// to two server rows. A plain `.some()` check would treat both locals as covered
// by the first persisted server row and collapse them into one — losing the
// second message until its own row lands.

/** Match key for reconciling a local message against its server twin: role +
 * normalized content. User content strips the trailing file-note; assistant
 * content is compared trimmed. */
function messageMatchKey(message: HermesUiMessage): string {
  const content =
    message.role === "user"
      ? normalizeUserContentForCompare(message.content)
      : message.content.trim();
  return `${message.role}\u0000${content}`;
}

/** After Stop, Core may persist the full reply while the client still holds a
 * strict prefix in an optimistic assistant bubble. Only treat the server row
 * as superseding when it landed at or after the local bubble (so an older
 * reply that happens to share a prefix does not swallow a new turn). */
function isPartialStreamSuperseded(
  local: HermesUiMessage,
  server: HermesUiMessage[],
): boolean {
  if (local.role !== "assistant" || !isLocalMessage(local)) return false;
  const localContent = local.content.trim();
  if (!localContent) return false;
  const localTime = Date.parse(local.createdAt);
  if (Number.isNaN(localTime)) return false;

  return server.some((candidate) => {
    if (candidate.role !== "assistant") return false;
    const serverContent = candidate.content.trim();
    const serverTime = Date.parse(candidate.createdAt);
    return (
      !Number.isNaN(serverTime) &&
      serverTime >= localTime &&
      serverContent.length > localContent.length &&
      serverContent.startsWith(localContent)
    );
  });
}

export function mergeHermesMessageLists(
  previous: HermesUiMessage[],
  server: HermesUiMessage[],
): HermesUiMessage[] {
  const merged = [...server];
  const seenIds = new Set(server.map((message) => message.id));

  // Count server rows per match key so each local message can consume at most
  // one matching server row before being considered "covered".
  const serverRemaining = new Map<string, number>();
  for (const message of server) {
    const key = messageMatchKey(message);
    serverRemaining.set(key, (serverRemaining.get(key) ?? 0) + 1);
  }

  // Rows already shown as persisted server messages in the UI consumed their
  // slot — a new optimistic message with the same text still needs its own row.
  for (const message of previous) {
    if (isLocalMessage(message) || !seenIds.has(message.id)) continue;
    const key = messageMatchKey(message);
    const remaining = serverRemaining.get(key) ?? 0;
    if (remaining > 0) serverRemaining.set(key, remaining - 1);
  }

  for (const message of previous) {
    if (!isLocalMessage(message) || seenIds.has(message.id)) continue;

    const key = messageMatchKey(message);
    const remaining = serverRemaining.get(key) ?? 0;
    if (remaining > 0) {
      // A persisted server row already covers this local message — consume it
      // (so a second identical local still needs its own row) and drop the local.
      serverRemaining.set(key, remaining - 1);
      continue;
    }

    if (isPartialStreamSuperseded(message, server)) {
      continue;
    }

    merged.push(message);
    seenIds.add(message.id);
  }

  return merged;
}
