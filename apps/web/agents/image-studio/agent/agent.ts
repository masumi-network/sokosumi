import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * The Project image studio agent.
 *
 * Scoped on purpose: its entire tool surface is four image tools, and it has
 * no access to Sokosumi's wider capability set. It is not Soko Bot and shares
 * none of its persona, memory, or capabilities.
 *
 * A direct provider model rather than a Gateway id: this deployment has an
 * `ANTHROPIC_API_KEY` and no `AI_GATEWAY_API_KEY`, and a model string would
 * silently require the latter.
 */
export default defineAgent({
  /**
   * No shell, no filesystem, no web access. The agent's whole surface is the
   * four image tools beside this file, so the optional defaults are all
   * capability it does not need and should not be able to reach. Turning them
   * off also means the agent needs no sandbox at all.
   */
  defaultTools: false,
  model: anthropic(),
});
