import type { z } from "zod";
import { askSmallModel, SMALL_MODEL } from "@/lib/soko-bot/small-model";

/** Small and cheap: each call reads a few dozen short lines and writes a few. */
export const COMPETITOR_CHECK_MODEL = SMALL_MODEL;

/** One structured answer from the check's model, with what it cost. */
export type AskCompetitorModel = <T>(input: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}) => Promise<{ output: T; costUsd: number }>;

export const askCompetitorModel: AskCompetitorModel = (input) =>
  askSmallModel({ ...input, purpose: "cmo" });
