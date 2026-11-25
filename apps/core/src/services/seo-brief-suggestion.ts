import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { evaluateWithJev } from "@/lib/soko-bot/jev";
import type { SeoBriefContent } from "@/schemas/seo-audit-brief.schema";
import { seoBriefAction } from "@/schemas/seo-page.schema";

type Action = SeoBriefContent["pages"][number]["action"];

// No host, user input, customer-specific slug, query, or page contents reach the model.
const routeCues = new Set([
  "pricing",
  "plans",
  "shop",
  "store",
  "products",
  "checkout",
  "signup",
  "sign-up",
  "register",
  "subscribe",
  "newsletter",
  "docs",
  "documentation",
  "guides",
  "help",
  "support",
  "blog",
  "learn",
  "downloads",
  "download",
  "book",
  "booking",
  "contact-sales",
  "demo",
]);
const locale = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const JUDGE_TIMEOUT_MS = 2_000;
const MIN_CHOICE_PROBABILITY = 0.75;
const CUE_CACHE_MS = 10 * 60 * 1_000;

// The question and state are identical for a cue across all users. The finite vocabulary
// bounds the map, and concurrent mounts share its promise, including the manual fallback.
const answers = new Map<
  string,
  { expiresAt: number; result: Promise<Action> }
>();

async function judgeCue(cue: string): Promise<Action> {
  try {
    const result = await evaluateWithJev({
      state: cue,
      questions: {
        action: {
          type: "choice",
          instructions:
            "The state is the public section name of a URL. Suggest the likely visitor action for that section. Choose unsure when the name does not clearly support one action.",
          criteria: {
            buy: "Evaluate a price or plan, shop, or complete a purchase.",
            read: "Read instructions, help, or editorial content.",
            "sign up": "Create a new account or register.",
            subscribe: "Subscribe to recurring content.",
            "contact sales": "Contact the sales team.",
            book: "Schedule a booking or demo.",
            download: "Download a file or application.",
            unsure: "The section does not point to one clear action.",
          },
        },
      },
      timeoutMs: JUDGE_TIMEOUT_MS,
      requireChoiceProbability: true,
    });
    const answer = result.answers.get("action");
    if (
      answer?.type !== "choice" ||
      !(answer.probabilities[answer.choice] >= MIN_CHOICE_PROBABILITY)
    )
      return null;
    const action = seoBriefAction.safeParse(answer.choice);
    return action.success ? action.data : null;
  } catch (error) {
    recordCoreWarning(
      { operation: "seo_setup_action_suggestion" },
      {
        message: "The SEO setup suggestion was unavailable.",
        why: "The page action judge did not complete its read.",
        fix: "Choose a page action manually. If this repeats, check the AI Gateway.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return null;
  }
}

export async function suggestSeoPageAction(url: string): Promise<Action> {
  const path = URL.parse(url)?.pathname;
  if (!path) return null;
  const [first, second] = path.toLowerCase().slice(1).split("/", 2);
  const cue = locale.test(first) ? second : first;
  if (!routeCues.has(cue)) return null;
  const now = Date.now();
  const cached = answers.get(cue);
  if (cached && cached.expiresAt > now) return cached.result;
  const result = judgeCue(cue);
  answers.set(cue, { expiresAt: now + CUE_CACHE_MS, result });
  return result;
}
