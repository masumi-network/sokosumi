import type { CmoBrandAnswer } from "@sokosumi/soko-bot";

/** A yes/no question of a Brand Brain or a Marketing strategy version. */
interface AnswerableQuestion {
  id: string;
  answer?: CmoBrandAnswer;
  note?: string;
}

/**
 * Questions saved again keep the members' answers: bots ask, only members
 * answer, so an answer a save leaves out is the stored one.
 */
export function keepAnswers<T extends AnswerableQuestion>(
  incoming: T[],
  stored: AnswerableQuestion[],
): T[] {
  return incoming.map((question) => {
    const answered = stored.find((candidate) => candidate.id === question.id);
    if (!answered?.answer || question.answer) return question;
    const merged = { ...question, answer: answered.answer };
    if (answered.note === undefined) delete merged.note;
    else merged.note = answered.note;
    return merged;
  });
}

/** Words that carry no meaning of their own in a yes/no question. */
const FILLER = new Set(
  "a an the your you our we is are do does did can will have has for of to in on at and or it its this that".split(
    " ",
  ),
);

function questionWords(question: string): Set<string> {
  return new Set(
    question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      // "buyers" and "buyer" are one word here.
      .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word))
      .filter((word) => word && !FILLER.has(word)),
  );
}

/**
 * Two questions that ask the owner the same thing: the same id, or nearly
 * the same words ("Are independent writers your main buyers?" and "Are
 * independent writers the main buyer for Buttondown?").
 */
export function sameQuestion(
  left: { id: string; question: string },
  right: { id: string; question: string },
): boolean {
  if (left.id === right.id) return true;
  const a = questionWords(left.question);
  const b = questionWords(right.question);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.8;
}

/**
 * Questions saved again while the owner is answering them: what the owner
 * answered stays, first and as asked, so the count they see only grows and
 * nothing is asked twice. The new questions follow, up to `max` in all.
 */
export function keepAskedQuestions<
  T extends AnswerableQuestion & { question: string },
>(incoming: T[], stored: T[], max: number): T[] {
  const answered = stored.filter((question) => question.answer);
  const fresh = incoming.filter(
    (question) => !answered.some((asked) => sameQuestion(asked, question)),
  );
  return [...answered, ...fresh].slice(0, Math.max(max, answered.length));
}

/** Only a no carries a note: what is true instead. */
export function answerNote(
  answer: CmoBrandAnswer,
  note: string | undefined,
): string | undefined {
  return answer === "no" ? note?.trim() || undefined : undefined;
}

/**
 * A new or changed no means Cuso has not fitted this answer yet. Clear the
 * revision notes so the plan UI asks for Update plan again: `planUnfitted`
 * treats a non-empty changes list as already fitted.
 */
export function changesAfterPlanAnswer(input: {
  changes: readonly string[] | undefined;
  previous?: Pick<AnswerableQuestion, "answer" | "note">;
  answer: CmoBrandAnswer;
  note: string | undefined;
}): string[] {
  const changes = [...(input.changes ?? [])];
  const reopensFit =
    input.answer === "no" &&
    (input.previous?.answer !== "no" || input.previous?.note !== input.note);
  return reopensFit ? [] : changes;
}
