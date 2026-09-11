/**
 * The name a Soko Bot is shown under.
 *
 * A bot is named by whoever set it up, and an unnamed one still has to be
 * called something wherever it appears: a room's roster, a direct room's name,
 * a mention preview.
 *
 * It sits here rather than beside the chat room routes because the rule is a
 * pure one, and helpers that build a notification must not have to import a
 * route module to ask it. That import pulls the whole route graph, Better Auth
 * and the Stripe client included, into anything that reaches a notification.
 */
export function sokoBotDisplayName(bot: { name: string | null }): string {
  const named = bot.name?.trim();
  if (named) return named;
  return "Soko Bot";
}
