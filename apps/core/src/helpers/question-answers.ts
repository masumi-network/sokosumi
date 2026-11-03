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
    return answered?.answer && !question.answer
      ? { ...question, answer: answered.answer, note: answered.note }
      : question;
  });
}

/** Only a no carries a note: what is true instead. */
export function answerNote(
  answer: CmoBrandAnswer,
  note: string | undefined,
): string | undefined {
  return answer === "no" ? note?.trim() || undefined : undefined;
}
