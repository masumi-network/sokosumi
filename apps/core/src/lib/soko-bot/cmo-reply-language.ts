import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { evaluateWithJev } from "@/lib/soko-bot/jev";

/** Enough of a message to tell its language; its end is the owner's own words. */
const SAMPLE_CHARS = 300;

const PIECES =
  "Only the words of a piece itself (a post, an ad, an email, with its title) stay in the strategy's contentLanguage.";

function sample(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(-SAMPLE_CHARS)
    .replace(/"/g, "'");
}

/** The languages Jev names; any other is left to the quoted message. */
const LANGUAGES = [
  "English",
  "German",
  "French",
  "Italian",
  "Spanish",
  "Portuguese",
  "Dutch",
] as const;
const OTHER = "other";
/** Below this Jev is guessing: a name, a link, "ok". */
const MIN_LANGUAGE_PROBABILITY = 0.8;
const LANGUAGE_TIMEOUT_MS = 5_000;
/** "ok" and "SEO test 2" read as English to Jev whoever wrote them: the newest message at least this long names the language. */
const TELLING_CHARS = 16;
/** Owner messages read to find one that long. */
const MESSAGES_READ = 5;

/**
 * The language of the owner's message by name, from Jev: told "English",
 * Cuso does not have to tell it himself from a quote under German context.
 * Null when Jev is unsure or fails, and the quote stands alone.
 */
async function languageOf(quoted: string): Promise<string | null> {
  try {
    const { answers } = await evaluateWithJev({
      state: { message: quoted },
      questions: {
        language: {
          type: "choice",
          instructions:
            "Which language is the message written in? Names, links and quoted titles do not count.",
          criteria: {
            ...Object.fromEntries(
              LANGUAGES.map((language) => [
                language,
                `The message is written in ${language}.`,
              ]),
            ),
            [OTHER]: "Another language, or too short to tell.",
          },
        },
      },
      timeoutMs: LANGUAGE_TIMEOUT_MS,
      requireChoiceProbability: true,
    });
    const answer = answers.get("language");
    return answer?.type === "choice" &&
      answer.choice !== OTHER &&
      (answer.probabilities[answer.choice] ?? 0) >= MIN_LANGUAGE_PROBABILITY
      ? answer.choice
      : null;
  } catch {
    return null;
  }
}

/**
 * The note that ends a Cuso turn's message. `current` is a chat turn the
 * owner's message started; any other turn (a follow-up, a rhythm, an event)
 * has only Core's brief, so it is shown what the owner last wrote.
 */
export function cmoReplyLanguageNote(input: {
  quoted: string;
  language: string | null;
  current: boolean;
}): string {
  const { quoted } = input;
  const named = input.language ?? "the owner's language";
  const write = input.language
    ? `Write to the owner in ${input.language}: their`
    : "Write to the owner in the language of their";
  return input.current
    ? `[Reply language. ${write} new message${input.language ? ` is in ${input.language} and` : ", which"} ends: "${quoted}" The earlier messages (your own included), the Brand Brain, the strategy and the posts may be in another language: your reply, a question and each report_update card are in ${named} all the same. ${PIECES}]`
    : `[Reply language. ${write} latest chat message${input.language ? ` is in ${input.language} and` : ", which"} ends: "${quoted}" It is quoted only for its language and is already answered: do not act on it. This brief, your plan, your earlier messages, the Brand Brain, the strategy and the posts may be in another language: your reply or DONE report, a question, each report_update card and what explains a strategy to the owner are in ${named} all the same. ${PIECES} When the brief quotes a newer request of the owner's, its language wins, and an answer the brief asks for word for word ("Nothing to add.") stays exactly as asked.]`;
}

/**
 * Cuso answered English messages in German, and reported follow-ups in
 * English to an owner writing German: the rule in his prompt sat far from the
 * message, behind a German strategy and his own earlier messages. So every
 * Cuso turn ends with the owner's latest chat message, its language by name
 * and the rule beside it.
 * Before the owner has written, his strategy skill's rule stands alone, and
 * any other bot gets no note.
 */
export async function cmoReplyLanguageFor(
  turnId: string,
): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { sokoBotId: true, versionId: true, createdAt: true },
  });
  if (!turn || getSokoBotVersion(turn.versionId).profile !== "cmo") return null;
  const asked = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: turn.sokoBotId,
      source: "CHAT",
      parentTurnId: null,
      chainDepth: 0,
      createdAt: { lte: turn.createdAt },
    },
    orderBy: { createdAt: "desc" },
    take: MESSAGES_READ,
    select: {
      id: true,
      userMessage: true,
      chatMention: { select: { message: { select: { content: true } } } },
    },
  });
  // A turn the API started has no chat message behind it: its own text is
  // the owner's, and Core's wrappers put their words in the last paragraph.
  const messages = asked
    .map((message) =>
      sample(
        message.chatMention?.message.content ??
          message.userMessage.split(/\n\s*\n/).at(-1) ??
          "",
      ),
    )
    .filter((message) => message.length > 0);
  const quoted = messages[0];
  if (!quoted) return null;
  return cmoReplyLanguageNote({
    quoted,
    language: await languageOf(
      messages.find((message) => message.length >= TELLING_CHARS) ?? quoted,
    ),
    current: asked[0]?.id === turnId,
  });
}
