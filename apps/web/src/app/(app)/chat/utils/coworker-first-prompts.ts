import type { CoworkerOffer, CoworkerProfile } from "@sokosumi/core-client";

export interface CoworkerFirstPrompt {
  /** Shown on the button. */
  label: string;
  /** Put in the composer. */
  text: string;
}

const MAX_PROMPTS = 3;

/**
 * Up to three first requests for an empty Coworker chat, from the Coworker's
 * own example prompts, then its Ready-To-Run offers. None when it has neither.
 */
export function coworkerFirstPrompts(
  metadata:
    | { profile?: CoworkerProfile; offers?: CoworkerOffer[] }
    | null
    | undefined,
): CoworkerFirstPrompt[] {
  const candidates = [
    ...(metadata?.profile?.examples ?? []).map((example) => ({
      label: example,
      text: example,
    })),
    ...(metadata?.offers ?? []).map((offer) => ({
      label: offer.title,
      text: offer.prompt,
    })),
  ];
  const prompts: CoworkerFirstPrompt[] = [];
  for (const candidate of candidates) {
    const label = candidate.label.trim();
    const text = candidate.text.trim();
    if (!label || !text || prompts.some((prompt) => prompt.text === text)) {
      continue;
    }
    prompts.push({ label, text });
    if (prompts.length === MAX_PROMPTS) break;
  }
  return prompts;
}
