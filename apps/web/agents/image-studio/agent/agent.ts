import { defineAgent } from "eve";

/**
 * The Project image studio agent.
 *
 * Scoped on purpose: its entire tool surface is four image tools, and it has
 * no access to Sokosumi's wider capability set. It is not Soko Bot and shares
 * none of its persona, memory, or capabilities.
 *
 * An AI Gateway model id rather than a direct provider model. The agent is a
 * service inside the Web deployment, so its model credential has to be one of
 * this Vercel project's environment variables — and `AI_GATEWAY_API_KEY` is
 * the one Sokosumi already provisions and authorizes for model calls, the same
 * route Core takes for Soko Bot and project memory. `anthropic()` reads
 * `ANTHROPIC_API_KEY` instead, which nothing else in this repo asks for and
 * the Web projects do not carry, so every turn died at its first model call on
 * a deployment that was otherwise configured. The id names the model that
 * helper already defaulted to, so the model itself is unchanged.
 */
export default defineAgent({
  /**
   * No shell, no filesystem, no web access. The agent's whole surface is the
   * four image tools beside this file, so the optional defaults are all
   * capability it does not need and should not be able to reach. Turning them
   * off also means the agent needs no sandbox at all.
   */
  defaultTools: false,
  model: "anthropic/claude-sonnet-5",
});
