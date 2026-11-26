// Adapted from marketingskills by Corey Haines (MIT): https://github.com/coreyhaines31/marketingskills (copy-editing, offers, pricing, lead-magnets, referrals, ai-seo)
import type { WritingSkill } from "./types.js";

export const GROWTH_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "copy-editing",
    group: "playbooks",
    name: "Copy editing",
    description:
      "Use when tightening, proofreading or fixing copy that already exists, or one line of it, without writing it again from scratch.",
    channels: [],
    content: `# Copy editing

Editing makes existing copy clearer and shorter. It keeps the owner's message, argument and words. Rewriting from scratch is a different job.

## Pick the mode first

- **One line or one word**: the owner asked about a specific bit. Change only that and the minimum around it. Return just the changed lines, each with a one-line reason. Leave the rest as it is.
- **A real voice that drifted**: the copy sounds like a person, with some weak spots. Keep their argument and their words; fix only what the passes below find.
- **Empty or generic copy**: it could belong to any business. Say so, and rebuild it from the business's facts, in the brand's voice (read brand-voice).

## The passes, in order

Read the copy once per pass. Each pass looks for one thing.

1. **Clear**: one idea per sentence, one main idea per section, written to "you". Split long sentences. Replace words a customer would have to look up.
2. **Voice**: it sounds like the brand from start to end. Watch for copy that starts warm and turns stiff, or mixes "we" and "the company".
3. **So what**: every feature says what it means for the reader. "Open Sundays" becomes "Open Sundays, so you can drop the dog off before the week starts."
4. **Proof**: every claim has a fact behind it from the Brand Brain, the business's site or the owner. A claim with nothing behind it ("loved by thousands", "the best in town") gets cut or softened, and you ask the owner for the real number or quote. Never add a number to make a line stronger.
5. **Specific**: swap vague words ("improve", "great", "solutions") for the real thing: the product's name, the price, the time it takes. If no fact exists, cut the line rather than invent one.
6. **The ask**: near the button or the last line, answer the doubt someone has right before acting (price, what happens next, can I cancel). Only with facts the business gave.

## Tells that make copy sound machine-written

The checks for social posts already refuse "it's not X, it's Y", "not just X, but Y", stock words (game-changer, unlock, elevate, seamless, leverage, delve), "Here's the thing", "The result?" and em dashes. Remove those too, and also:

- **"No X, no Y, no Z" lists**: "No contracts, no fees, no stress." Say the one fact that matters: "Cancel any month."
- **Lists of three by reflex**: "fast, friendly and reliable". Keep the one adjective with proof, cut the rest.
- **Filler openers**: "When it comes to...", "In a world where...", "Whether you're X or Y...", "Looking for...?"
- **Sentences that trail off in extra comma clauses**: "We clean the whole house, making your weekend easier, giving you time back." End the sentence after the first clause.
- **Hedges and filler words**: "arguably", "may help to", "it's worth noting", "really", "truly", "incredibly", "very". Delete them; the sentence is stronger without.
- **Sweeps**: "From busy parents to growing teams". Name the one buyer.
- **Grand closers**: "Because you deserve it." "The future of baking is here." End on the fact or the ask.

## Example

A made-up dog groomer's page, before:

\`\`\`
When it comes to your furry friend, we believe every dog deserves the best. Our experienced, caring and passionate team offers a wide range of grooming solutions, making every visit a joy.
\`\`\`

After:

\`\`\`
Full groom for small dogs, 2 hours, 65 francs. Book online and we text you when your dog is ready.
\`\`\`

The facts (price, time, the text message) came from the owner's site. Where they are missing, ask before editing.

## What you hand back

The edited copy, then a short list of what changed and why, in plain words ("Cut 'experienced, caring and passionate': nothing on the site backs it up"). Flag claims you cut for lack of proof so the owner can send the fact.`,
    checklist: [
      {
        rule: "It keeps the original message and the owner's own words wherever they were clear.",
      },
      {
        rule: "Every claim it keeps has a fact behind it from the brand facts, the business's site or the owner.",
      },
      {
        rule: "Sentences end after their point, with no trailing comma clauses, filler openers or hedges.",
      },
      {
        rule: "It uses the one adjective or fact that matters instead of reflex lists of three or 'no X, no Y, no Z' lists.",
      },
      {
        rule: "Features are tied to what they mean for the reader.",
      },
      {
        rule: "It sounds like the brand's voice from first line to last.",
        voice: true,
      },
    ],
  },
  {
    id: "offer",
    group: "playbooks",
    name: "Offer",
    description:
      "Use when deciding or sharpening what a customer gets for the price: what's included, extras, guarantee, payment options, bundles, why buy now.",
    channels: [],
    content: `# Offer

The offer is the deal itself: what someone gets, what they pay, how they pay, what happens if it does not work, and why now. Better words on a weak deal help little. A clear, fair deal sells with plain words.

Work from the owner's real terms. You can suggest changes to the deal, but the owner decides them. Never present a guarantee, a discount, a deadline or a limit the owner has not agreed to.

## Write the offer out in one block

Before any page or post, put the current deal in plain words, one line each, filled from the Brand Brain and the site:

- **Name**: what it is called.
- **For**: who it is for, in their words.
- **You get**: the main thing, then each part.
- **Extras**: anything added, each with the doubt it answers.
- **Price**: the price, and how to pay.
- **If it does not work**: the owner's real promise, or "none given".
- **Why now**: a real reason, or "none".

A line you cannot fill from the facts is a question for the owner, never a gap you fill yourself or a bracket left in the text.

## Make it easier to say yes

Look at four things and fix the weakest one first:

- **The result**: say what the customer ends up with, not what you do. "Your books ready for the tax office by March" beats "monthly bookkeeping".
- **Belief it will work**: real proof (a named customer, a number from the business), a clear method, a promise.
- **Time to the first win**: what happens in the first week? Shorten it if the owner can.
- **Effort for the customer**: done for them, fewer steps, nothing to learn.

## Extras

Each extra answers one doubt a buyer has. "I won't have time to set it up" gets a setup call. "What if I get stuck?" gets a month of email help. Extras must be things the business really provides. Never give an extra a made-up "worth" figure.

## Guarantee

Only if the owner gives one, and in their exact terms. Write it with the condition and the time: "If your first month's books are not done by the 10th, you don't pay for that month." Vague promises ("satisfaction guaranteed") say nothing; leave them out. If the owner has none, write without one.

## Why now

Only reasons that are true and that the owner will keep:

- a real limit on how many they can take ("We take four new clients a month");
- a start date ("The spring course starts 3 April");
- a season ("Tax returns close 31 March");
- a price change on a real date, if the owner confirms it.

Never invent countdowns, "only 3 left", or a "regular price" that was never charged. If there is no real reason, end on the plain next step instead.

## Options and payment

- **Three options** help when buyers differ: a small one, the one most people should pick (mark it), a full one. Each step up adds something a real buyer wants. Two or one is fine when the business is simple.
- **Bundles**: put together things people already buy together, at a price the owner sets.
- **Payment**: monthly, upfront, or a deposit, as the owner offers. Show the total, never hide it.
- Avoid discounts to win new customers; they teach people the price is soft. Reward existing customers instead, if the owner wants to.

## Example

A made-up bookkeeper, structure only:

\`\`\`
Name: Books Done
For: freelancers who dread tax season
You get: monthly bookkeeping, a tax-ready file each March
Extras: a 30-minute setup call (for "I don't know where to start")
Price: 120 francs a month, or 1,300 a year upfront
If it does not work: owner to confirm
Why now: four new clients a month (owner's limit)
\`\`\``,
    checklist: [
      {
        rule: "It states plainly what the customer gets, what it costs and how they pay.",
      },
      {
        rule: "Every guarantee, discount, deadline and limit in it is one the owner gave.",
      },
      {
        rule: "Each extra is tied to a doubt it answers and carries no invented value figure.",
      },
      {
        rule: "It names the result the customer ends up with, not only the work done.",
      },
      {
        rule: "Its reason to act now is true, or it ends on a plain next step instead.",
      },
      {
        rule: "Open questions for the owner are listed instead of filled with guesses.",
      },
    ],
  },
  {
    id: "lead-magnet",
    group: "playbooks",
    name: "Free download",
    description:
      "Use when planning something free to give away for an email address (checklist, template, short guide), its sign-up page or its delivery email.",
    channels: [],
    content: `# Free download

A free download trades something useful for an email address. It works when it solves one small problem the buyer has today, and when that problem sits next to what the business sells.

## Pick the topic

- **One specific problem**, not a broad topic. "The 12 receipts freelancers forget to claim" beats "A guide to taxes".
- **Close to the product.** Someone who finds it useful should be a likely buyer. A wedding florist gives away a flower budget sheet, not a wedding playlist.
- **From what the business already knows**: questions customers ask, a checklist the owner uses, a past article that did well.

## Pick the format

- **Checklist**: steps or things to check, one page, each item one action.
- **Template**: something people fill in (a budget sheet, a plan, a letter). Usable in five minutes, with an example filled in.
- **Short guide**: three to seven short sections, one idea each, ten pages at most.
- **Price or cost sheet**: what something usually costs and what changes it, when people search for prices before they buy.

One format only. Usable in under ten minutes. Works on a phone. Ends with one next step toward what the business sells.

## Ask for little

Email only, unless the owner needs more for a real reason. A first name is fine when the emails will use it. Every extra field puts some people off.

## The sign-up page

In this order:

1. **Headline**: what they get and what it does for them. "The freelancer's receipt checklist: claim what you're owed."
2. **A picture of it**: the cover or the first page.
3. **What's inside**: three to five lines, each a concrete thing they will learn or get.
4. **Proof**, only if real: a download count or a customer quote the owner has.
5. **The form**: the email field and a button that names the thing ("Send me the checklist").
6. **One line on what happens next**: "It arrives in your inbox now. After that, one email a week; unsubscribe any time." Say how often you will email, and keep that promise.

## After sign-up

- **Thank-you page**: "Check your inbox", a direct link to download, and one next step (book a call, see the menu, read a related article).
- **The delivery email**, sent at once:

\`\`\`
Subject: Your receipt checklist
Preview: Plus the one receipt most freelancers miss

Hi,

Here is your checklist: [Download the checklist](https://...)

Start with item 4, home office costs. It is the one people miss most.

Next week I'll send how to file receipts in two minutes a day.

Lea
\`\`\`

Keep it short: the link, one useful tip, what comes next. Later emails are newsletter issues (read newsletter).

## Where to offer it

At the end of a related article (read seo for the article itself), in the profile link on social networks, and in posts that share one item from it.

## Never

- Something people must pay to use, or that only works on one software they may not have.
- A download count, review or result the business does not have.
- Mailing people more often than the page promised.`,
    checklist: [
      {
        rule: "It solves one named problem that sits next to what the business sells.",
      },
      {
        rule: "It uses one format that is usable in minutes and ends with one next step toward the business.",
      },
      {
        rule: "The form asks for the email address and only what the owner needs beyond it.",
      },
      {
        rule: "The page says what is inside, what happens after sign-up and how often emails will come.",
      },
      {
        rule: "The delivery email holds the download link, one useful tip and what comes next.",
      },
      {
        rule: "Every download count, quote or result shown is one the owner has.",
      },
    ],
  },
  {
    id: "referral-program",
    group: "playbooks",
    name: "Referrals",
    description:
      "Use when setting up refer-a-friend or word of mouth: what to reward, how much, when to ask, the ask message, or asking customers for reviews.",
    channels: [],
    content: `# Referrals

Happy customers already tell friends. A referral program makes that easier and says thank you. For a small business, the ask matters more than the reward.

## When to ask

Ask right after a good moment, while it is fresh:

- the job is delivered and the customer said thanks;
- they reach a result (first tax return filed, first month of classes done);
- they buy again or renew;
- support solved a problem quickly.

Never ask at sign-up or before they have got anything from the business.

## What to reward

- **Both sides** usually works best: the friend gets a welcome, the customer gets a thank you. "Give your friend 20 francs off their first clean, and get 20 francs off your next one."
- **Credit in the business** (a free class, money off the next order) costs the owner less than cash and brings the customer back.
- **Reward the purchase, not the sign-up**, so the owner pays only for real customers.
- **How much** is the owner's decision. A starting point to suggest: about what the owner would happily spend to win one new customer. Show it the way it sounds bigger: "20 francs off" on a small price, "a free month" on a subscription.
- Some businesses do better with no reward at all: a simple "Know someone who would like this?" fits a doctor, a lawyer or anyone whose customers would feel odd being paid.

## Make sharing easy

Give the customer a message they can forward as it is, and one link or code. They should not have to explain the business themselves.

The ask, from a made-up cleaning company:

\`\`\`
Hi Maria, glad the flat is sparkling clean for the move.

If a friend needs a cleaner, send them this link: [link]
They get 20 francs off their first clean, and you get 20 francs off your next one.

Thanks, Tom
\`\`\`

And the message the customer forwards:

\`\`\`
I use Clean Corners for my flat and they're great. Here's 20 francs off your first clean: [link]
\`\`\`

Say thank you when a referral turns into a customer, even when there is no reward.

## Reviews

Reviews on Google, Facebook or the network the business's buyers use are word of mouth that stays.

- **Ask every customer the same way**, not only the happy ones. Picking only happy customers breaks Google's rules and readers notice.
- **Never pay or reward for a review**, and never ask for a good one. Ask for an honest one.
- **Send the direct link** to the review form, and keep the ask to two or three sentences.
- **Ask at the same good moment** as a referral; send one reminder at most.

\`\`\`
Thanks for coming in, Jonas. Would you write a short, honest review of your visit? It helps other people find us. [link]
\`\`\`

- **Answer every review**, especially the bad ones: thank them, own the problem in one sentence, offer to fix it by email or phone. Never argue in public and never share private details.
- Reuse a review on the site or in posts only with the reviewer's first name and with the owner's go.

## Never

- Invent referral counts, rewards or reviews.
- Promise a reward the owner has not agreed to.
- Ask for a review in exchange for a discount.`,
    checklist: [
      {
        rule: "The ask comes right after a good moment for the customer.",
      },
      {
        rule: "Every reward in it is one the owner agreed to, and it rewards a purchase.",
      },
      {
        rule: "It gives the customer a ready message to forward with one link or code.",
      },
      {
        rule: "Review requests ask for an honest review, with a direct link and no reward.",
      },
      {
        rule: "Replies to reviews thank the reviewer and move any problem to a private channel.",
      },
      {
        rule: "Every number, reward and review mentioned is one the owner has.",
      },
    ],
  },
  {
    id: "ai-search",
    group: "playbooks",
    name: "AI answers",
    description:
      "Use when helping the business get named in AI answers (ChatGPT, Perplexity, Google AI Overviews): which pages, facts and outside mentions to add.",
    channels: [],
    content: `# AI answers

More buyers ask ChatGPT, Perplexity or Google's AI answer instead of clicking through results. Those tools quote short passages from pages they trust, and they name businesses that many sources describe the same way. The goal: the business's own pages state its facts plainly, and other sites say the same.

Good search pages are the base. For writing an article or fixing a page's title, read seo. This skill decides which pages and facts to add, and where else the business should be mentioned.

## Find out where the business stands

If the owner wants a check, write the questions their buyers would type into a chat box, in the buyer's words:

- the problem: "How do I stop my sourdough going flat?"
- the kind of business: "Best bakery for wedding cakes in Zurich"
- the business itself: "Is Northside Bakery good for gluten-free?"
- the details: "Northside Bakery prices", "Does Northside deliver?"

Ask the owner to put each one into ChatGPT and Perplexity a few times (answers change between runs) and note: is the business named, who is named instead, and which pages are quoted. Report it in plain words: "ChatGPT named you in 2 of 5 tries for 'wedding cakes Zurich'; it quoted a local wedding blog each time."

If an answer gets a fact wrong, the page that should state that fact does not say it plainly. Fix that page first.

## Pages that get quoted

- **A clear "what we do" page**: who the business is, what it sells, for whom, where, since when, in the first paragraph.
- **A plain prices page**, readable as text, not only in an image or a PDF.
- **Questions and answers**: the questions customers really ask, each answered in two to four sentences that make sense alone.
- **Comparisons**: "[Business] or [other option]", with a table of price, who it is for and the main difference. Fair to the other side.
- **How-to pages** for the problems the product solves, with numbered steps.
- **Facts only the business has**: its own numbers, its process, a small survey of its customers. Original facts get quoted more than general advice.

## How to write them

- Answer first: the opening sentence of each section answers the heading's question.
- Headings phrased the way people ask.
- One fact per sentence, with the number and the date when there is one ("Delivery in Zurich, 8 francs, since 2024").
- The same name, description and prices on every page. Mixed facts make the tools unsure.
- A visible "last updated" date on pages with prices or numbers.
- Never write separate copy "for AI". The same page serves people and these tools.

## Mentions on other sites

AI tools trust what others say about a business. Suggest the owner, in plain steps:

- keep the Google Business Profile complete, with the same description and hours as the site;
- list the business in the directories and review sites of its trade and town;
- ask happy customers for honest reviews (read referral-program);
- offer a local paper, trade blog or podcast a real story or useful fact;
- answer questions in forums where buyers ask (Reddit, trade groups) as the owner, saying who they are.

## Never

- Invent reviews, awards, press mentions or numbers to look more trusted.
- Post fake forum answers or reviews.
- Stuff pages with repeated search words; it makes them quoted less.`,
    checklist: [
      {
        rule: "Each section opens with a direct answer to its heading's question.",
      },
      {
        rule: "It states the business's name, offer, place and prices the same way as its other pages.",
      },
      {
        rule: "Each fact is in a sentence that makes sense on its own, with its number or date when there is one.",
      },
      {
        rule: "Comparisons use a table and treat the other option fairly.",
      },
      {
        rule: "Every number, review, award and mention in it comes from the brand facts, the site or the owner.",
      },
      {
        rule: "Owner-facing advice is in plain steps the owner can take.",
      },
    ],
  },
];
