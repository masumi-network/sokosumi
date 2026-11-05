"use client";

import Markdown from "@/components/markdown";

/** A writing skill's Markdown, rendered as Cuso reads it. */
export function WritingSkillMarkdown({ content }: { content: string }) {
  return <Markdown>{content}</Markdown>;
}
