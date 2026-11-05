import type { CmoChannelKey } from "@sokosumi/utils";

export type WritingSkillGroup = "foundations" | "social" | "ads" | "long_form";

/** One rule a finished piece is checked against. */
export interface WritingRule {
  rule: string;
  /** The formats it applies to; every format of the skill's channels when unset. */
  formats?: readonly string[];
  /** It counts characters or items: Core checks it in code, never the evaluator, which cannot count. */
  counted?: boolean;
}

/**
 * How to write for one network or kind of piece. Cuso reads a skill before he
 * writes that kind of piece; each made piece is checked against its
 * checklist, so the rules live in one place.
 */
export interface WritingSkill {
  id: string;
  group: WritingSkillGroup;
  name: string;
  /** When to use it, in one line. */
  description: string;
  /** The channels it covers; a foundation covers every piece. */
  channels: readonly CmoChannelKey[];
  /** The skill in Markdown: what works, the shape of each format, examples. */
  content: string;
  /** Rules a reader can check on the finished text alone. */
  checklist: readonly WritingRule[];
}
