import { z } from "zod";
import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v24's skill: the tools a turn kind uses are named in its core, and the
 * two big save tools come in a short form on turns that rarely save.
 */
export const CMO_TOOL_HIGHLIGHTS_SKILL = "cmo-tool-highlights";

/** Whether a Cuso version gets tool highlights and short save tools (cmo-v24). */
export function cmoHighlightsTools(skills: readonly string[]): boolean {
  return skills.includes(CMO_TOOL_HIGHLIGHTS_SKILL);
}

/** The save tools that may come in a short form: 68 KB of schema between them. */
export const CMO_SHORT_FORM_TOOLS = [
  "save_strategy",
  "save_brand_brain",
] as const;
export type CmoShortFormTool = (typeof CMO_SHORT_FORM_TOOLS)[number];

export function isCmoShortFormTool(name: string): name is CmoShortFormTool {
  return (CMO_SHORT_FORM_TOOLS as readonly string[]).includes(name);
}

/** The short form's input: what Cuso means to save, so the call is cheap. */
export const cmoShortFormInputSchema = z.object({
  shortForm: z
    .literal(true)
    .describe("Always true: this is the short form of the tool."),
  what: z.string().max(300).describe("What you want to save, in one line."),
});

/** A call made with the short form, as Core receives it. */
export function isCmoShortFormCall(
  capability: string,
  input: unknown,
): capability is CmoShortFormTool {
  return (
    isCmoShortFormTool(capability) &&
    typeof input === "object" &&
    input !== null &&
    (input as { shortForm?: unknown }).shortForm === true
  );
}

export const CMO_SHORT_FORM_DESCRIPTIONS: Record<CmoShortFormTool, string> = {
  save_strategy:
    "Save the marketing strategy, its calendar or single pieces. This is the short form: calling it saves nothing and gives you the full save_strategy from your next step, with every field. Call it with shortForm true and one line on what you want to save, then call save_strategy again with the full input.",
  save_brand_brain:
    "Save the Brand Brain's essentials or profile sections. This is the short form: calling it saves nothing and gives you the full save_brand_brain from your next step, with every field. Call it with shortForm true and one line on what you want to save, then call save_brand_brain again with the full input.",
};

/** What a short-form call returns. */
export function cmoShortFormAnswer(tool: CmoShortFormTool): {
  saved: false;
  next: string;
} {
  return {
    saved: false,
    next: `Nothing was saved: that was the short form of ${tool}. The full ${tool} is yours from the next step for the rest of this turn; call it again with the whole input.`,
  };
}

export const CMO_TOOL_HIGHLIGHTS: SokoBotSkill = {
  id: CMO_TOOL_HIGHLIGHTS_SKILL,
  name: "The tools for this turn",
  description:
    "Names the tools that fit each turn; the big save tools come in a short form on turns that rarely save.",
  content: `# The tools for this turn

workspace.marketing.core.toolsForThisTurn names the tools that fit this kind of turn. Start with those. Every other tool still works when the turn needs it.

save_strategy and save_brand_brain may come in a short form on turns that rarely save (a question, a thank-you, an event). Its description says so. When you need to save on such a turn, call the short form with shortForm true and one line on what you want to save: nothing is saved, and from your next step the full tool is yours for the rest of the turn. Then call it again with the whole input, exactly as you would have.`,
};
