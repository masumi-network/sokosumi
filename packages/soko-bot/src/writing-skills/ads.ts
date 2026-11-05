import type { WritingSkill } from "./types.js";

export const AD_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "meta-ads",
    group: "ads",
    name: "Facebook and Instagram ads",
    description:
      "Read before any Meta ad: primary text that works in 125 characters, a headline, one action.",
    channels: ["meta_ads"],
    content: `# Facebook and Instagram ads

An ad is shown to people who did not ask for it. It has a second to earn attention and must say plainly what the offer is. Each ad is saved as a file the owner launches, with every field labelled.

## Fields

- **Primary text**: the words above the image. The first 125 characters show before "more"; the whole ad must work in those. One to three short sentences.
- **Headline**: under the image, about 27 to 40 characters. Name the offer or the result.
- **Description**: optional, about 25 characters, shown on some placements only. Never put anything important here.
- **Call to action button**: one of Meta's buttons (Shop now, Learn more, Sign up, Book now, Get offer). Pick the one that matches the funnel stage.

## What works

- Lead with the customer's problem or the result, not the brand name.
- One offer per ad, with its price as the Brand Brain lists it, when that helps.
- Proof when the Brand Brain has it: a number, a review in the customer's words.
- The image and the text say different things: the text never just describes the image.
- Write each ad for one buyer motivation, in the buyer's own words. Ads that are more than half alike count as one, so vary the angle, not the wording: two or three variants with different hooks (a problem, a result, a question) let the owner test them.

## Formats

**image_ad**: primary text, headline, description, button, and the image brief.

**carousel_ad** (2 to 10 cards): one shared primary text, and per card a headline of about 40 characters and its image. Each card shows one product or one step; the first card is the strongest.

## Example shape

A made-up meal kit, structure only:

\`\`\`
Primary text: Dinner on the table in 20 minutes, with no shopping and no waste. Pick 3 recipes, we bring exactly what you need.
Headline: Your first box, 3 dinners for 2
Description: Pause any week
Button: Get offer
\`\`\`

## Never

- Claims the Brand Brain cannot back ("the best", "guaranteed")
- Personal attributes Meta forbids ("Are you struggling with debt?", "Other people your age...")
- ALL CAPS, more than one emoji, or a wall of text`,
    checklist: [
      {
        rule: "The primary text leads with the customer's problem or the result, then the offer.",
      },
      { rule: "The headline names the offer or the result." },
      {
        rule: "One offer and one call to action button that matches the funnel stage.",
      },
      {
        rule: "No claim the brand facts cannot back and no personal attributes ('Are you...').",
      },
      {
        rule: "Every field is labelled (Primary text, Headline, Description, Button).",
        formats: ["image_ad"],
      },
      {
        rule: "Carousel ad: one shared primary text, and a headline and image for each card, the strongest first.",
        formats: ["carousel_ad"],
      },
      {
        rule: "The primary text's point fits in 125 characters; a headline of about 27 to 40 characters.",
        counted: true,
      },
    ],
  },
  {
    id: "google-ads",
    group: "ads",
    name: "Google Ads",
    description:
      "Read before any Google ad: headlines of 30 characters and descriptions of 90 that answer the search.",
    channels: ["google_ads"],
    content: `# Google Ads

A search ad answers what someone just typed. It wins by matching the search, naming the offer and giving a reason to click this result and not the next one.

## Search ads

- **Headlines**: 8 to 15, each at most 30 characters. Google mixes them, so each must make sense on its own and next to any other. Cover different angles: the search itself ("Bookkeeping for Freelancers"), the offer, the price, proof, the action ("Start Free Today").
- **Descriptions**: 2 to 4, each at most 90 characters. A full sentence with the benefit and one action.
- **Keywords**: 5 to 15 phrases people type when they need the offer, never the brand name alone.
- Use the words people search for, in their language and spelling.
- Title Case is common in headlines; follow it unless the voice says otherwise.
- Count characters before you save. A headline of 31 characters is refused.

## Display ads (image ads on websites)

- **Short headline**: at most 30 characters.
- **Long headline**: at most 90 characters, shown without the image on some sites.
- **Description**: at most 90 characters.
- **Business name**: the brand as people know it.
- The image brief: one subject, little or no text on the image.

## Example shape

A made-up bookkeeping app, structure only:

\`\`\`
Headlines:
- Bookkeeping for Freelancers
- Receipts Sorted in Minutes
- From 9 EUR a Month
- Ready for Your Tax Return
- Try It Free for 30 Days
Descriptions:
- Snap receipts, match your bank feed and send your accountant one clean file each quarter.
- Built for freelancers who would rather work than sort paper. Start your free month today.
\`\`\`

## Never

- A headline that only works next to another one
- Exclamation marks in headlines, ALL CAPS words, or repeated punctuation
- A price or promise the Brand Brain does not hold`,
    checklist: [
      {
        rule: "Search ad: each headline makes sense on its own and next to any other.",
        formats: ["search_ad"],
      },
      {
        rule: "Search ad: the headlines cover different angles: the search, the offer, the price or proof, the action.",
        formats: ["search_ad"],
      },
      {
        rule: "Search ad: each description is a full sentence with a benefit and an action.",
        formats: ["search_ad"],
      },
      {
        rule: "Display ad: a short headline, a long headline, a description and the business name.",
        formats: ["display_ad"],
      },
      {
        rule: "No exclamation marks in headlines, no ALL CAPS, no claim the brand facts cannot back.",
      },
      {
        rule: "Headlines of at most 30 characters, long headlines and descriptions of at most 90.",
        counted: true,
      },
    ],
  },
];
