import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v3's strategy skill: cmo-v2's plan in pieces with a fuller month
 * (owner, 2026-11-16), as exact replacements of its text so the rest stays
 * word for word. Every network the business is on gets pieces, plus up to two
 * where its buyer is; a pace counts per network per day; ads are a test the
 * owner chooses; every piece is built from concrete material; and the month
 * is saved week by week, so a long calendar fits.
 */
const REVISIONS: readonly (readonly [string, string])[] = [
  [
    "- channels: the channels from the menu below that serve the strategy's way of attracting, not every channel the business has. seo in almost every plan: it compounds month after month. A social network the business is on but the strategy does not need gets a light cadence or none; say why. newsletter when the owner has a mailing list. An ads channel when paid reach fits the strategy (meta_ads or google_ads, whichever reaches this buyer).",
    '- channels: every live social network in the menu the business has an account on (the Brand Brain\'s channels and marketingToday) is in the plan, with pieces at the pace: its audience is already there, and showing up everywhere the buyers are is what the owner hires you for. Add the networks from the menu where this buyer spends time but the business has no account yet, at most two (LinkedIn for a business that sells to companies, Instagram for a shop, a restaurant or anything people want to see, X when its market talks there). Their why starts with "New:" and says the owner opens the account; they get the lighter rate in pace. Never add a network that does not fit the buyer (a bakery on X). Further networks that would fit go in proposals. seo in every plan: it compounds month after month. newsletter when the owner has a mailing list. An ads channel when paid reach fits the strategy (meta_ads or google_ads, whichever reaches this buyer); it is a test the owner chooses to try (see ads and questions), so the plan works without it.',
  ],
  [
    "- pace: how hard the plan publishes. all_in: 15 or more a week. active: 6 to 14 a week, about one or two a day across the main channels. steady: 2 to 5 pieces a week. Every first plan is all_in; the owner lowers it with one tap. Once the owner picks a pace, keep it in every later plan. level, why (at most 12 words, why this pace fits the brand) and perWeek, inside the level's range. The calendar holds about four times perWeek pieces.",
    "- pace: how hard the plan publishes, counted per social network in the plan, every day of the week. steady: one a day on each network. active: two a day on each. all_in: three a day on X and two a day on LinkedIn, Facebook and Instagram. A network the business has no account on yet gets one every other day, whatever the pace. Each network keeps its own rate: never reach perWeek by piling one network (the plan review refuses more than three a day on X or two on another). Write each social channel's cadence as its daily rate, such as 2 a day. On top, seo gets a page fix and an article every week (steady: one of them a week), the newsletter an issue every week or two when there is a list, and an ads channel its ads. Every first plan is all_in; the owner lowers it with one tap. Once the owner picks a pace, keep it in every later plan. level, why (at most 12 words, why this pace fits the brand) and perWeek: the pieces a week this adds up to (all_in on X, LinkedIn and Instagram with seo: 21 + 14 + 14 + 2 = 51). The calendar holds about four times perWeek pieces.",
  ],
  [
    "- ads: paid ads are the only part that costs the owner more, so always recommend an amount and say it plainly.",
    "- ads: paid ads are the only part that costs the owner more, so always recommend an amount and say it plainly. Most owners do not start with ads in their first month: present them as a test they can switch on, and let the rest of the plan reach the goal on its own.",
  ],
  [
    "each checking one of your biggest assumptions (an estimate in the funnel, the entry offer, the ad budget, a channel's role)",
    "each checking one of your biggest assumptions (an estimate in the funnel, the entry offer, a channel's role)",
  ],
  [
    "State your estimate and ask if it holds.",
    'State your estimate and ask if it holds. When the plan has an ads channel, one question asks whether the owner wants to try it, with the channel and your amount in it ("Do you want to try Google Ads with about CHF 600 a month?"); never ask whether an amount is reasonable or enough. A no means monthly 0 and no ads channel.',
  ],
  [
    "- Plan plenty, and plan variety. A founder hires you to show up everywhere their buyers are: about one social post every weekday across the networks, a page fix each week and an article every two weeks for SEO, a newsletter every two weeks when there is a list, and two to four ads when the plan has an ads channel. Use at least six different formats across the month, at least two on every social channel, and most social pieces with an image you make: people stop for pictures, and a multi-image post explains a process step by step.",
    "- Plan plenty, and plan variety. A founder hires you to show up everywhere their buyers are, every day: the pace sets how many pieces a day each network gets, and two to four ads go in when the plan has an ads channel. Use at least six different formats across the month and at least two on every social channel. One X post in three has an image you make; on LinkedIn, Facebook and Instagram most pieces do: people stop for pictures, and a multi-image post explains a process step by step.",
  ],
  [
    "- Specific beats generic: name the products, the audience's real problems, the competitors' weaknesses, the offer. A title that could fit any company is wrong.",
    "- Specific beats generic: name the products, the audience's real problems, the competitors' weaknesses, the offer. A title that could fit any company is wrong.\n- Build every piece from concrete material, never a theme. Before the calendar, list the material the Brand Brain holds: each named feature or product, release, customer and their result, number, price and offer, customer quote, difference from a named competitor, and how-to step. Each calendar title names its material (\"The fee calculator in three clicks\", not \"Fees explained\"), and week one's briefs say which item they use. A long month reuses material in other formats (a how-to, a comparison, a customer story, a quote card), never the same claim twice in a week, and no two titles say the same thing in other words: the plan review reads every title for repeats. When the material runs short, add questions to the community and the buyer's real situations, not reworded tips.",
  ],
  [
    "Send the calendar in a call of its own: it is the longest part.",
    "Send the calendar in calls of its own: it is the longest part. A whole month does not fit one call: save week one with part calendar, then each later week with part patch (only that week's entries, each with a new id; a new id adds an entry and every saved one stays). Every week holds about perWeek entries in the mix and pillar shares: count them before you save (all_in on three networks is about 50 a week, not 7). A week too long for one call goes in two part patch calls. The plan review asks for the weeks still missing until all four are in.",
  ],
];

export function weeklyStrategy(base: SokoBotSkill): SokoBotSkill {
  const content = REVISIONS.reduce((text, [before, after]) => {
    if (!text.includes(before)) {
      throw new Error(
        `cmo-strategy-weekly: "${before.slice(0, 60)}" is not in ${base.id}`,
      );
    }
    return text.replace(before, after);
  }, base.content);
  return { ...base, id: "cmo-strategy-weekly", content };
}
