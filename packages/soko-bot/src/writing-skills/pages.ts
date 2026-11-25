// Adapted from marketingskills by Corey Haines (MIT): https://github.com/coreyhaines31/marketingskills (copywriting, pricing, competitors, cro, signup, popups, marketing-psychology)
import type { WritingSkill } from "./types.js";

export const PAGE_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "landing-page",
    group: "playbooks",
    name: "Landing page",
    description:
      "Use when writing or rewriting a homepage, landing page or feature page, or choosing its headline and button words.",
    channels: [],
    content: `# Landing page

A homepage, landing page or feature page has one job: a stranger understands in a few seconds what this is, who it is for, and what to do next. Facts come only from the Brand Brain, the fact catalogue, the business's own site or what the owner said. Read brand-voice for the words and seo for the page title and description.

## First, what were you given?

- **A blank brief or generic copy**: build the page from the facts. You choose the angle, never the facts.
- **A draft with a real voice**: keep the owner's argument and words. Fix the buried point, vague lines and order. If they write "stuff", do not swap it for "solutions".
- **A point edit** ("fix the headline"): change only that, plus what is needed around it to fit. Return the rest untouched, with one line on why each change is better. Revert any change you cannot give a reason for.

## One promise

Before any line, write one sentence: who it is for, what they get, and why from this business. Every section supports that sentence.

- **Homepage**: speaks to the main buyer and gives other visitors a clear path.
- **Landing page**: one message, one button, and a headline that matches the ad or post that sent people there.
- **Feature page**: the feature, what it means for the buyer, a real example.

## Sections, in this order

1. **Headline**: the promise in the buyer's words. Specific beats clever. Shapes that work: "[Outcome] without [pain]", "[What it is] for [who]", a question that names the pain.
2. **Subheadline**: one or two sentences that add who, how or how fast.
3. **Main button**: a verb and what they get ("Book a tasting", "Get my quote"). "Start free for 14 days" only when that trial exists. Never "Submit", "Learn more" or "Click here".
4. **Proof near the top**: real reviews, numbers or names (read social-proof). None yet? Leave it out.
5. **The problem**: the buyer's situation in their words, two or three lines.
6. **What you get**: three to five benefits, each a fact plus what it means for them.
7. **How it works**: three or four steps, so it feels easy.
8. **Doubts answered**: price, "will it work for me", effort, "what if it does not work". A guarantee only when the owner offers one.
9. **Last button**: the promise in one line and the same button again.

Leave a section out when there is nothing true to put in it.

## Every line

- Can the reader picture it? Can it be checked true or false? Could a rival paste it onto their own site unchanged? If yes to the last, rewrite it from a fact, or mark [NEED: what makes you different] and ask the owner.
- Most lines are plain. One or two get punch, usually the headline.
- Say what happens, not a list of what is absent. One real absence near the button is fine ("No card needed").
- No exclamation marks and no questions you answer yourself.

## Honest persuasion

Help people decide; never push. Deadlines and limits only when real. A decline link on a form or popup is neutral ("No thanks"), never a guilt line.

## Output

Organize by section: headline, subheadline, button, then each section's heading and text. Give two other headlines and two other button texts, each with a short reason. End with every [NEED: ...] as a plain question for the owner.

## Example shape

A made-up dog-walking service, structure only:

\`\`\`
Headline: Your dog walked at noon, every weekday
Subheadline: One walker who knows your dog, 45 minutes, a photo after each walk.
Button: Book a meet-and-greet
How it works: 1. Meet your walker at home. 2. Pick your days. 3. Get a photo after each walk.
Doubts: What if my walker is ill? ...
Last button: Book a meet-and-greet

[NEED: how many dogs you walk today, and two client quotes you may share]
\`\`\``,
    checklist: [
      {
        rule: "The headline states one promise in the buyer's words.",
      },
      {
        rule: "The main button names what the visitor gets, in words other than Submit, Learn more or Click here.",
      },
      {
        rule: "Each benefit names a concrete fact and what it means for the buyer.",
      },
      {
        rule: "Every claim, number and quote comes from the business's facts, and missing proof appears as a [NEED: ...] question for the owner.",
      },
      {
        rule: "Deadlines, limits, trials and guarantees appear only where the business's facts hold them.",
      },
      {
        rule: "A point edit changes only the asked part and gives a one-line reason for each change.",
      },
    ],
  },
  {
    id: "pricing-page",
    group: "playbooks",
    name: "Pricing page",
    description:
      "Use when writing or fixing a pricing page: plan names, what each plan includes, which plan to highlight, monthly vs yearly, price questions.",
    channels: [],
    content: `# Pricing page

People on a pricing page mostly want it already. They ask three things: which one, how much, and is there a catch. The page answers those fast. Prices, plans and what each includes come only from the owner, the Brand Brain or the current site. This skill writes the page; it does not set prices. If the owner asks what to charge, say what you would need to know and leave the decision to them.

## Order

1. **A heading that says who the plans are for**, not just "Pricing".
2. **The plans side by side**, two to four. Each card: plan name, the price in text with currency and what it is per (month, person, visit), one line "For ...", three to six things included, and its own button.
3. **One plan highlighted** as the one most buyers should pick, with a short label that is true ("Most popular" only when the owner says so; otherwise "Best for most shops"). Pick it by what most customers need, never just the dearest.
4. **Monthly or yearly**: when both exist, show a switch. Show yearly as a per-month figure plus the yearly total, and the saving as the owner states it ("2 months free"). Never a crossed-out price that was never charged.
5. **Full comparison** under the cards when plans differ in more than a few things. Rows in words with the real limits ("Up to 3 people", "5 GB"), not only ticks.
6. **Questions**: the real ones. Can I change plans? What happens at the limit? Is there a contract, can I cancel? Any setup fee? Which payment methods? Refunds or trial (only when real)? Is tax included?
7. **Proof and a last button**: a real quote about value for money, if there is one (read social-proof).

## Plan names

Name plans for who they serve or how much they hold ("Solo", "Team", "Studio"; "Small, Medium, Large"), so visitors can pick themselves. Metal or gem names say nothing. Keep names the owner already uses on invoices.

## What each plan includes

- Lead with the thing that changes between plans (people, visits, products, hours), then "Everything in Solo, plus ...".
- Buyer words, not internal feature names.
- The same order of items on every card, so they compare at a glance.

## Prices on the page

- Always in text, never only inside an image.
- Show at least a starting price. "Contact us" only for a plan the owner truly quotes case by case, and then say what decides the quote.
- Name every extra cost the owner tells you about (setup, delivery, tax). A cost found after the button costs trust.
- No fake "was" prices, no countdown timers, no "only 2 places left" unless the owner says it is true.

## Buttons

Each plan's button names the next step: "Start Solo", "Book a call about Studio". "Start free for 14 days" only when that trial exists.

## Example shape

A made-up yoga studio. Structure only; every price comes from the owner.

\`\`\`
# Classes that fit your week

[Monthly | Yearly, 2 months free]

Drop-in     [price] a class    For trying us out         [Book a class]
10 classes  [price]            For once a week           [Buy 10 classes]
Unlimited   [price] a month    For three or more a week  [Start Unlimited]
            Label: Best for regulars

## Questions
Do the 10 classes expire? ...
Can I pause Unlimited when I travel? ...
\`\`\``,
    checklist: [
      {
        rule: "Every price is written in text with its currency and what it is per.",
      },
      {
        rule: "Each plan has a line saying who it is for and its own button naming the next step.",
      },
      {
        rule: "One plan is highlighted, with a label the business's facts support.",
      },
      {
        rule: "Every price, saving, trial, refund and limit comes from the owner or the current site.",
      },
      {
        rule: "Where yearly billing exists, it shows the per-month figure and the yearly total.",
      },
      {
        rule: "The questions cover changing plans, cancelling and any extra costs.",
      },
    ],
  },
  {
    id: "comparison-page",
    group: "playbooks",
    name: "Comparison page",
    description:
      'Use when writing an "X vs Y", "X alternative" or "best X alternatives" page, or deciding what a page may say about a rival business.',
    channels: [],
    content: `# Comparison page

Someone searching "X vs Y" or "X alternative" is close to choosing and will check what you say. The page wins by being the most useful and fair page on that search. Every line about the rival must survive the rival reading it. Read seo for the page's title, description and search words.

## Before writing

- Know which rival. If the owner or the strategy does not name one, ask, and stop there.
- Facts about the business come from the Brand Brain, the fact catalogue, its site or the owner. Facts about the rival come only from pages you read now: their site, price list, help pages, public reviews. Note the date you read each.
- Ask the owner: why customers switched to them, who the rival serves better, and whether they help people move over.

## Three kinds of page

1. **"[Rival] alternative"** (they want to leave): why people look elsewhere (from real reviews), the business as the alternative in two lines, the comparison, who should switch and who should not, how moving over works, a switcher's quote if real, a button.
2. **"Best [Rival] alternatives"** (still looking): what to look for, then four to seven real options including the business (first is fine), a summary table, a short honest note on each, a pick by situation.
3. **"[Business] vs [Rival]"**: the main difference in two or three sentences at the top, a table, a paragraph per topic (price, what is included, ease, support), who each is best for, a button.

## Fair claims

- **Not seen is not absent.** If their price list does not mention a thing, write "not listed on their site (checked Nov 2026)" or drop the row. Write "no" only when their own pages say so.
- **Date every rival fact that can change**: prices, plans, features. Put "Their prices as of [month year]" under the table.
- **What changed, never why.** "They moved phone support to their top plan" is a fact. A guess at their motive is not.
- **Keep three things apart**: what their site says, what it means for the buyer, what you recommend.
- No insults and no review figures you did not see yourself.
- Quotes from public reviews: real, short, unchanged, with the site named.

## When the rival is better

Say so. If the rival suits bigger teams, has more locations, or costs less for light use, write it under "Who [Rival] is best for". That honesty makes the rest believable, and people the business does not suit leave before they become unhappy customers. Never claim the business wins every row; where both are the same, say so.

## The table

Rows a buyer cares about, in words: "Price for one person", "Delivery area", "Cancel any time". Real values in each cell, not only ticks.

## Example shape

A made-up bike repair shop against a chain, structure only:

\`\`\`
# Spoke & Co vs CycleFix: which repair shop fits you?

Spoke & Co repairs bikes the same day when you drop off by 10am. CycleFix has more shops across the city. If you need a shop near you on the other side of town, CycleFix is the easier pick.

| | Spoke & Co | CycleFix |
|---|---|---|
| Standard service | [price] | [price] (their site, Nov 2026) |
| Same-day repair | Yes, drop off by 10am | Not listed on their site (checked Nov 2026) |
| Shops | 1 | [number from their site] |

## Who Spoke & Co is best for
## Who CycleFix is best for
\`\`\``,
    checklist: [
      {
        rule: "It opens with the main difference in a few sentences before any table.",
      },
      {
        rule: "Every fact about the rival can be found on a public page, and prices and features carry the date they were checked.",
      },
      {
        rule: 'Anything not found on the rival\'s pages is written as "not listed" with a date, or left out.',
      },
      {
        rule: "It has a section saying who the rival is best for.",
      },
      {
        rule: "It states what the rival did without guessing their reasons, and contains no insult.",
      },
      {
        rule: "Table cells hold real values in words.",
      },
    ],
  },
  {
    id: "page-review",
    group: "playbooks",
    name: "Page review",
    description:
      "Use when the owner asks why a page or form gets visits but few sign-ups, bookings or sales, or what to change on it first.",
    channels: [],
    content: `# Page review

The owner asks "why are people not signing up?" or "what should I change?". Give a short, ordered answer they can act on today, in plain words. Read the live page first, never from memory. Ask only what you cannot see: what should a visitor do here, and where do most visitors come from. Rewrites of the copy itself follow landing-page or pricing-page.

## What to check, most important first

1. **Clear in five seconds?** What it is, who it is for, why this business. The most common problem is a clever or vague headline.
2. **Matches where people came from?** An ad about "same-day repair" that lands on a general homepage loses people.
3. **One main next step?** One button that says what they get, visible without scrolling and repeated lower down. Many equal buttons split attention.
4. **Proof next to the doubt**: real reviews or numbers near the button and after big claims (read social-proof).
5. **Doubts answered**: price, "will it work for me", effort, "what if it does not work".
6. **Friction**: a long form, unclear steps, a slow page, a page that breaks on a phone.

## Forms

For each field ask: do we need it before we can help? Could we ask later?

- **Keep**: email; a name when someone replies personally; the one question that lets the owner help ("What needs fixing?").
- **Cut or make optional**: phone (unless they call back, then say why), company size, job title, "how did you hear about us", a second email box, a full address before a quote.
- Labels above the fields, not only grey text inside them. One column. The button says what happens ("Get my quote"), with a line under it saying when they will hear back.
- Sign-up: let people in with as little as possible and ask the rest once they have seen the product.

## Popups

Only when they offer something real and do not cover the page in the first seconds. A clear close button and a neutral decline ("No thanks"). Never a guilt line ("No, I hate saving money"), a fake timer or an invented discount.

## What not to recommend

- Tools or data the owner does not have. Say "if you have visitor recordings, ..." only when they do.
- Promised figures ("this will lift sales 30%"). Say in words what you expect.
- Fake urgency or made-up proof to fill a gap.

## What to keep

Name what already works (a clear price, a real photo, a good review) so it is not removed with the rest.

## Output to the owner

Plain words, no marketing terms. At most five fixes, most important first. Each one: what to change, the new words when it is copy, and why in one sentence. Then "Keep", and "I need from you" when something is missing.

A made-up florist, structure only:

\`\`\`
1. Change the headline. Now: "Petals with passion". New: "Flowers delivered in Bristol today, order by 2pm". Why: visitors cannot tell what you sell or where.
2. Move the order button to the top. Today it sits under three photos, so on a phone most people never reach it.
3. Shorten the order form. Keep name, email, delivery address and card message. Drop "how did you hear about us" and the second email box.
4. Add two real reviews next to the button.

Keep: your price list and the photos of real bouquets.
I need from you: two customer messages I may quote, with first names.
\`\`\``,
    checklist: [
      {
        rule: "The fixes are in order of importance, each with the change and a one-sentence reason.",
      },
      {
        rule: "Every copy fix gives the new words, ready to paste.",
      },
      {
        rule: "It names what to keep.",
      },
      {
        rule: "It is written in plain words a non-marketer understands, free of marketing terms.",
      },
      {
        rule: "Each fix relies only on data and tools the owner has, and expected effects are described in words rather than promised figures.",
      },
      {
        rule: "Form advice names which fields to cut and which to keep.",
      },
    ],
  },
  {
    id: "social-proof",
    group: "playbooks",
    name: "Social proof",
    description:
      "Use when adding reviews, customer quotes, numbers, logos or customer stories to a page, post or ad, or asking the owner for real proof.",
    channels: [],
    content: `# Social proof

People trust other customers more than the business itself. Real reviews, quotes, numbers, names and stories placed next to a claim or a button make it believable. Fake ones destroy trust and can break the law. Use only proof that is in the Brand Brain, the fact catalogue, the business's site, its public review pages or what the owner gave you.

## Kinds, strongest first for a small business

1. **A specific customer quote with a name**: "Fixed my bike the same morning, I made my train." Ana P., Leeds. Specific beats praise ("Great service").
2. **A short customer story**: who they were, the problem, what the business did, what changed. Three to five sentences. Numbers only when the customer or the owner gave them.
3. **A review score and count** from a public site, exactly as shown, with the site named: "4.8 on Google from 212 reviews". Never rounded up.
4. **Real numbers about the business**: years open, orders delivered, customers served, as the owner states them.
5. **Names and logos** of known customers, only when the owner confirms they may be shown.
6. **Press, awards, certificates**: only real ones, named exactly.

## Where it goes

- **Page**: one strong quote or the score near the top; each quote beside the claim it backs (a quote about speed beside the speed promise); one near the main button and the form.
- **Post**: a quote or a short story can carry the whole post; read the network's skill for the shape.
- **Ad**: a short quote or the review score; read meta-ads or google-ads for the limits.

## Using quotes

- Shorten with "..." but never change the meaning or add words. Fix only obvious typos.
- Name who said it: first name and initial plus place or business, unless the customer agreed to more. The owner confirms permission for full names, photos and logos.
- Pick quotes that answer a doubt (price, speed, trust), not only "amazing".

## When there is none

Write the piece without it and do not pretend. No "Loved by hundreds" or "Trusted by businesses everywhere". Use what is true and checkable instead: the owner's own story and experience, how the work is done, a promise the owner stands behind, a photo of real work. Then ask for proof.

## Asking for real proof

Ask the owner in plain words and say exactly what to send:

\`\`\`
To make your page more believable, could you send me:
- 2 or 3 messages or reviews from happy customers (a screenshot is fine), and whether I may use their first name
- The link to your Google or other review page
- Any number you are sure of, like years open or orders done
- Names of customers who are happy to be named
\`\`\`

If they have none, give them a short note to send customers after a job:

\`\`\`
Thanks for choosing us. Would you write one or two sentences about how it went? With your OK, we may share it on our site with your first name.
\`\`\`

Never suggest paying or giving discounts for good reviews. Ask every customer, not only the happy ones, and follow the review site's own rules.

## Never

- An invented or placeholder quote, name, number, logo or star rating in finished work
- A review count rounded up, or a score without its source
- Stock photos presented as customers`,
    checklist: [
      {
        rule: "Every quote, number, score, name and logo traces to the owner, the business's site or a named public review page.",
      },
      {
        rule: "Each review score names its site and shows the exact figure.",
      },
      {
        rule: "Quotes keep the customer's meaning and name who said them.",
      },
      {
        rule: "Proof sits next to the claim or button it supports.",
      },
      {
        rule: "Where proof is missing, the piece makes no vague popularity claim and the owner gets a plain request saying what to send.",
      },
    ],
  },
];
