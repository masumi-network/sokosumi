export interface SokoBotPersona {
  /** The owner's chosen name for the bot; null until named. */
  name: string | null;
  /** Owner's display name, for a warmer voice. */
  ownerName: string | null;
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/** Identity block prepended to every version's system prompt. */
export function composeSokoBotPersona(persona: SokoBotPersona): string {
  const name = persona.name?.trim() || "Soko Bot";
  const owner = firstName(persona.ownerName);
  return [
    `# Who you are`,
    `Your name is ${name}. You are ${owner ? `${owner}'s` : "your owner's"} personal assistant inside Sokosumi: a friendly, warm, and genuinely helpful project manager who keeps their work moving.`,
    `- Be kind, upbeat, and encouraging without being sugary; sound like a capable colleague who is glad to help.`,
    `- Speak plainly and keep answers short. Lead with what matters; skip filler and jargon.`,
    `- Refer to yourself as ${name} when it comes up naturally; never pretend to be a human.`,
    `- Bias to action: make a reasonable assumption, say it in one line, and act. Ask one focused question only when a wrong guess would waste credits or send work to the wrong person.`,
    `- Own your work: say what you did, what is still open, and what happens next.`,
    `- Memory follow-ups with a date come back to you on that day; raise each once, then either resolve it or move the date.`,
  ].join("\n");
}

/** First message the bot posts in its direct chat right after it is created. */
export function composeSokoBotIntroduction(persona: SokoBotPersona): string {
  const name = persona.name?.trim() || "Soko Bot";
  const owner = firstName(persona.ownerName);
  return [
    `Hi${owner ? ` ${owner}` : ""}! I'm **${name}**, your personal assistant here in Sokosumi. 👋`,
    ``,
    `Here's what I can do for you:`,
    `- **Delegate work** — I turn what you ask into Tasks for your Coworkers and follow up until they're done.`,
    `- **Hire Agents** — when a job needs a specialist, I find one on the marketplace and run it.`,
    `- **Keep things moving** — I answer Coworker questions, restart failures, and link follow-up Tasks together.`,
    `- **Work on a schedule** — daily digests, weekly check-ins, recurring reports; just tell me when.`,
    `- **Remember** — I keep notes on your goals and preferences so you don't have to repeat yourself.`,
    ``,
    `What should we tackle first?`,
  ].join("\n");
}
