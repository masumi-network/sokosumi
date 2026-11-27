import { CMO_BRAND_ANSWERS } from "@sokosumi/soko-bot";
import { z } from "zod";
import { askSmallModel } from "@/lib/soko-bot/small-model";
import type { CmoPathBrand } from "./types";

const answerSchema = z.object({
  answer: z.enum(CMO_BRAND_ANSWERS),
  /** Only with "no": the one-line correction a real owner would type. */
  note: z.string().max(200).optional(),
});
export type OwnerAnswer = z.infer<typeof answerSchema>;

/**
 * The owner of a fictional brand, answering Cuso's yes/no questions from
 * what they know (the brand's brief) and nothing else. Answers are kept by
 * question so a rerun can replay them instead of asking again.
 */
export class SimulatedOwner {
  readonly answers = new Map<string, OwnerAnswer>();

  constructor(
    private readonly brand: CmoPathBrand,
    replay: ReadonlyMap<string, OwnerAnswer> = new Map(),
  ) {
    for (const [statement, answer] of replay)
      this.answers.set(statement, answer);
  }

  async answer(statement: string): Promise<OwnerAnswer> {
    const known = this.answers.get(statement);
    if (known) return known;
    const { output } = await askSmallModel({
      label: "cmo-path-owner",
      purpose: "evals",
      system: [
        `You are ${this.brand.owner.firstName}, the owner of ${this.brand.eval.name}. What you know:`,
        this.brand.ownerBrief,
        'Your marketing assistant states something about your business and asks you to confirm it. Answer "yes" when it matches what you know, "no" when it contradicts it (then give the correct fact in one short line as note), and "unsure" when what you know does not say.',
      ].join("\n\n"),
      prompt: statement.slice(0, 1_000),
      schema: answerSchema,
    });
    const answer = output.answer === "no" ? output : { answer: output.answer };
    this.answers.set(statement, answer);
    return answer;
  }
}
