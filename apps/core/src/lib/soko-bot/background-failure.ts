import {
  AI_BUDGET_EXCEEDED,
  AI_BUDGET_EXCEEDED_MESSAGE,
} from "@/lib/ai-gateway-budget";

type BackgroundFailureKind =
  | typeof AI_BUDGET_EXCEEDED
  | "turn_deadline_exceeded"
  | "unknown";

function backgroundFailureHeading(title: string, deadline: boolean): string {
  const how = deadline ? "ran out of time" : "failed";
  return `Background run "${title}" ${how} before it could report.`;
}

export function backgroundFailureText(
  title: string,
  kind: BackgroundFailureKind,
): string {
  const heading = backgroundFailureHeading(
    title,
    kind === "turn_deadline_exceeded",
  );
  if (kind === "turn_deadline_exceeded") return heading;
  const copy =
    kind === AI_BUDGET_EXCEEDED
      ? AI_BUDGET_EXCEEDED_MESSAGE
      : "Something went wrong on our side. Try again. If it keeps happening, contact support.";
  return `${heading} ${copy}`;
}

function legacyFailureKind(
  deadline: boolean,
  suffix: string,
): BackgroundFailureKind {
  if (deadline) return "turn_deadline_exceeded";
  return suffix === ` (${AI_BUDGET_EXCEEDED_MESSAGE})`
    ? AI_BUDGET_EXCEEDED
    : "unknown";
}

/** Old delivery messages appended a substring of the turn's raw error to this heading. */
export function readLegacyBackgroundFailure(
  content: string,
  metadata: unknown,
): { content: string; metadata: Record<string, unknown> } | null {
  if (!metadata || typeof metadata !== "object" || !("soko_bot" in metadata))
    return null;
  const bot = metadata.soko_bot;
  if (
    !bot ||
    typeof bot !== "object" ||
    !("background_run_title" in bot) ||
    typeof bot.background_run_title !== "string" ||
    "background_failure_kind" in bot
  )
    return null;

  const prefix = /^@\S+ /.exec(content)?.[0] ?? "";
  const text = content.slice(prefix.length);
  const title = bot.background_run_title;
  for (const deadline of [false, true]) {
    const heading = backgroundFailureHeading(title, deadline);
    if (
      text !== heading &&
      !(text.startsWith(`${heading} (`) && text.endsWith(")"))
    )
      continue;
    const kind = legacyFailureKind(deadline, text.slice(heading.length));
    return {
      content: `${prefix}${backgroundFailureText(title, kind)}`,
      metadata: {
        ...metadata,
        soko_bot: { ...bot, background_failure_kind: kind },
      },
    };
  }
  return null;
}

export function readBackgroundMessageContent(message: {
  content: string;
  metadata: unknown;
  senderSokoBotId: string | null;
}): string {
  return (
    (message.senderSokoBotId
      ? readLegacyBackgroundFailure(message.content, message.metadata)?.content
      : null) ?? message.content
  );
}

/** Stored previews carry the old delivery heading without its source metadata. */
export function readLegacyBackgroundFailureSnapshot(
  text: string,
): string | null {
  const match =
    /^(?:(@[^\n]*? ))?Background run "([\s\S]*?)" (failed|ran out of time) before it could report\.(?= \()/.exec(
      text,
    );
  if (!match) return null;
  const [heading, prefix = "", title = "", how] = match;
  const kind = legacyFailureKind(
    how === "ran out of time",
    text.slice(heading.length),
  );
  return `${prefix}${backgroundFailureText(title, kind)}`;
}
