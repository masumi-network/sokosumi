// Adapted from marketingskills by Corey Haines (MIT): https://github.com/coreyhaines31/marketingskills (skills: emails, cold-email, prospecting, public-relations, launch)
import type { WritingSkill } from "./types.js";

export const OUTREACH_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "email-sequence",
    group: "playbooks",
    name: "Email sequence",
    description:
      "Use when planning or writing automatic emails sent after a sign-up, purchase or long silence: welcome, getting started, follow-up or win-back.",
    channels: [],
    content: `# Email sequence

A sequence is a short run of emails that go out by themselves after something happens: someone signs up, buys, books, or goes quiet. The owner sets it up once in their email tool. A newsletter issue is a different job: read \`newsletter\` for that.

## Decide before writing

Write these four lines first and show them to the owner:

- **Starts when**: the one event that sends email 1 ("someone joins the list on the site", "first order placed").
- **Goal**: the one thing a reader does by the last email (books a first visit, places a second order, comes back).
- **Stops when**: they do the goal, reply, or buy. Nobody keeps getting "come and try us" after they came.
- **Emails**: how many and on which day.

## Which emails, in what order

Fewer, better emails. Each one has one job and one link.

**Welcome (after a sign-up), 3 to 5 emails over about two weeks**
1. Right away: thank them, give what was promised (the guide, the discount code the owner set, the booking link), say what they will get and how often.
2. Day 1 or 2: one quick win they can have today.
3. Day 3 or 4: why the business exists, in the owner's words.
4. Day 6 or 7: proof from a real customer, only if the Brand Brain holds one. Otherwise answer the most common worry.
5. Day 10 to 14: the plain offer and one link.

**Getting started (after a first purchase or account)**: right away, the one first step. Then help if they have not done it, one tip they would miss, and a short "how is it going?" that asks for a reply.

**Win-back (after a long silence)**, 2 or 3 emails: a friendly check-in, what is new since they last came, then an honest "should we stop writing?" with a one-click way to stay. Offer a discount only if the owner has one; never invent one.

## Subject and preview

- **Subject**: says what is inside, plainly ("Your first loaf is ready to book"). Clear beats clever. No fake "Re:" or "Fwd:", no ALL CAPS.
- **Preview**: adds to the subject and never repeats it.

## Each email

Open with the reason for writing, in the first line. Then why it matters to them, the useful part, one link on words that say where it goes, and a sign-off the owner would use. Short paragraphs, written to one reader. 50 to 150 words for a step email, up to 300 for a story.

## Example shape

A made-up yoga studio, welcome email 2, structure only:

\`\`\`
Email 2 of 4, day 2
Subject: Your first class, without the nerves
Preview: What to bring, when to arrive, and what happens.

Hi Sam,

Most people are nervous before their first class. Here is what the first hour looks like.

Arrive ten minutes early. Bring water; we have mats.

[Book your first class](https://...)

Mia
\`\`\`

## Deliver it as

For each email: number and day, subject, preview, body in Markdown, the link and where it goes. Above them, the four decision lines. Facts, prices, offers and proof only from the Brand Brain or the owner; when proof is missing, write the email without it and tell the owner what to send. Words follow \`brand-voice\`.

## Never

- An offer, deadline or "last chance" that is not real
- Two jobs in one email
- "Just checking in" with nothing new
- A button that shames the reader for saying no`,
    checklist: [
      {
        rule: "It states what starts the sequence, its one goal and what stops it.",
      },
      { rule: "Each email has one job and one main link." },
      {
        rule: "Each subject says what is inside, and each preview adds to it without repeating it.",
      },
      {
        rule: "Each email opens with its reason for writing in the first line.",
      },
      {
        rule: "Every offer, deadline, result and customer quote comes from the brand facts.",
      },
      { rule: "A reader who says no is treated with respect, never shamed." },
    ],
  },
  {
    id: "cold-email",
    group: "playbooks",
    name: "Cold email",
    description:
      "Use when writing a first email or follow-up to one named person or company who does not know the business yet: a partner, buyer or stockist.",
    channels: [],
    content: `# Cold email

One person, who has never heard of the business, gets an email they did not ask for. They decide in the first two lines whether it is for them. It reads like a note from a neighbour in their trade, never like a brochure.

## Find the reason first

Do not write until you can finish this sentence: "I am writing to you, now, because ___." Good reasons, best first:

- Something that just happened to them: a new shop opened, a new menu, a job post for the work the business does, a post where they named the problem.
- Something you can see from outside: their site has no online booking, their café sells no local bread.
- A real link between you: same street, same customer, a person who suggested them.

Read their site or recent posts to find it, and name where you saw it. If there is no reason for this person, say so to the owner and suggest someone with one. A list of names with no reason gets no email.

## The first email

Four short parts, under 120 words:

1. **Their world**: what you noticed about them, in one or two sentences. Remove it and the email should stop making sense.
2. **The problem it points to**, in their words.
3. **What the business does about it**, in one sentence, with one piece of proof only if the Brand Brain holds it (a named customer, a number). No proof? Leave it out; never invent one.
4. **One small ask** they can answer in one line: "Worth a look?", "Should I send the price list?". Never a 30-minute call in the first email.

Write "you" more than "we". Do not open with who you are. Sign with the owner's name.

**Subject**: two to four plain words that sound like a colleague ("bread for the café"). No pitch, no fake "Re:".

## Follow-ups

Two or three, each adding one new thing: another angle, a short tip, the proof you held back. Each must make sense alone. Space them out: about day 3, day 8, day 15. The last one says plainly this is the last note and leaves the door open. After that, stop. If they reply, stop all follow-ups at once.

## Example shape

A made-up bakery writing to a café owner, structure only:

\`\`\`
Subject: bread for the new place

Hi Lena,

Saw on your Instagram that the second café opens on Bahnhofstrasse next month. Two kitchens usually means two bread orders and two delivery times to juggle.

We bake for cafés in the old town and deliver both sites in one morning run.

Want me to send this week's list and prices?

Anna
Northside Bakery
\`\`\`

## Before it goes out

One plain line for the owner: send from their normal address, a handful a day, and include a line on how to opt out. Some countries need consent before a cold email even to a business; if the owner sells in the EU, tell them to check that first.

Deliver each email with its subject, the day it goes out, and one line naming the reason and where you saw it. Words follow \`brand-voice\`.`,
    checklist: [
      {
        rule: "The first lines name something specific about this person or company and where it was seen.",
      },
      {
        rule: "That opening leads straight into the problem the business solves.",
      },
      { rule: "It makes one small ask that can be answered in one line." },
      { rule: "It speaks about the reader more than about the business." },
      {
        rule: "Every proof, customer and number in it comes from the brand facts.",
      },
      {
        rule: "Each follow-up adds something new and makes sense on its own.",
      },
      { rule: "The subject is a few plain words with no pitch or fake reply." },
    ],
  },
  {
    id: "press-pitch",
    group: "playbooks",
    name: "Press pitch",
    description:
      "Use when pitching a story to a reporter, local paper or podcast host, or writing a short press release for the business.",
    channels: [],
    content: `# Press pitch

A reporter gets many pitches a day and opens the ones that look like a story their readers want. The story is never "this business exists". The business is the proof inside a bigger story.

## Is there a story?

Pick the strongest angle the facts support:

- **Something new and local**: an opening, a first in the town, a new service people there could not get before.
- **A person**: why the owner started, a turn in their life, a customer with a clear before and after (only with the customer's OK).
- **Small against big**: a local business doing something the chains do not.
- **A broken thing**: a common problem in the trade and what this business does differently. Aim at the problem, never at a rival.
- **Their own numbers**: something the owner counted or learned ("we tracked every return for a year"). Only real numbers.
- **News of the week**: a fresh angle on something in the news, sent within a day.

If none fits, tell the owner it is not a press story yet and suggest a post or newsletter instead. "We launched" alone is not news; the reason it matters to the reader is.

## Who to pitch

One named person per pitch, who covered something close in the last few months: the local paper's business or food writer, a trade magazine, a newsletter, a podcast host. Name the piece of theirs that made you pick them. A podcast host: name an episode you heard.

## The pitch

Under 150 words, plain text, no attachments.

1. **Subject**: reads like the headline they might write.
2. **Why them**: one line on their recent piece.
3. **The story**: one or two sentences, with the one fact that makes it news.
4. **Why their readers care**: one sentence.
5. **What you offer**: an interview with the owner, photos, a customer to talk to (only if real), the numbers.
6. **One clear ask** and how to reach the owner.

One polite follow-up after about four working days, with something new. Then stop.

## Example shape

A made-up repair shop, structure only:

\`\`\`
Subject: The Zurich shop that fixed 800 phones the stores said to bin

Hi Marco,

Your piece on e-waste last month stayed with me.

Since March, our two-person shop has fixed 800 phones that big stores told owners to replace. We kept a list of every one.

Your readers could save a few hundred francs before they buy new.

Happy to share the list and photos, and Jan, our founder, can talk this week.

Jan Keller, 079 ...
\`\`\`

## Short press release

Write one only for a real event (an opening, a new product, a named partner) and post it on the business's own site so reporters can check facts. Shape: a headline naming the business and what happened; a place and date line; a first paragraph that stands alone (who, what, when, why it matters); one paragraph of detail; one quote from the owner that gives a reason or opinion, never "we are thrilled"; where and when people can get it; two lines about the business; a named contact. Third person outside the quote, 250 to 400 words.

## Facts

Every number, customer, award and date comes from the Brand Brain or the owner. Tell the owner what to send when the story needs a fact you do not have. Words follow \`brand-voice\`.`,
    checklist: [
      {
        rule: "It names one reporter or host and a recent piece of theirs it builds on.",
      },
      {
        rule: "The story is stated in one or two sentences with the fact that makes it news.",
      },
      { rule: "It says why that outlet's readers or listeners would care." },
      { rule: "It ends with one clear ask and how to reach the owner." },
      {
        rule: "Every number, customer and quote comes from the brand facts or the owner.",
      },
      {
        rule: "A press release opens with a paragraph that tells the whole story on its own and quotes the owner giving a reason.",
      },
    ],
  },
  {
    id: "launch-plan",
    group: "playbooks",
    name: "Launch plan",
    description:
      "Use when announcing a new product, feature, service or opening: what to post where and in what order, waitlist, launch day and release notes.",
    channels: [],
    content: `# Launch plan

A launch is a few weeks of telling people something new, in order, with each step sending people to the place the business owns: its email list and its site. One post on the day is not a launch.

## Decide first

- **What is new**, in one sentence the customer would say: "You can now book online", "We open in Oerlikon on 3 May".
- **How big**: a new business or product gets the full plan below. A new service or real improvement gets an email, one post per network and a site update. A small fix goes in the release notes only.
- **Where people go**: one page on the business's site with the details and one thing to do (join the waitlist, book, buy). Every message links there.
- **The date**, only if the owner set it. Never invent a deadline or limited spots.

## The order

1. **Before (two to four weeks)**: tell the people closest first. A short email to the list and the owner's personal network: what is coming and why. Open a waitlist or early access on the launch page if it fits ("Join the list and you hear first"). Share one behind-the-scenes post a week on the networks the business uses: the making of, the problem it fixes, a first look.
2. **Early access (optional)**: let a small group in first and ask each for one honest sentence. With their OK, those sentences become the proof on launch day.
3. **Launch day**, in this order: update the site page, email the list (the waitlist first if there is one), then post on each network, then pin the post. The owner answers every comment that day.
4. **After (one to two weeks)**: a follow-up post with what people said or asked, a mention in the next newsletter, and a direct note to people who showed interest but did not act.

Read the network's skill for each post and \`newsletter\` for the list email.

## The launch-day post

Open with what is new and who it is for. Then one or two concrete details (what it does, the price as the offers list it, where, when). Then the one link. Real proof only if the Brand Brain or early users gave it.

## Example shape

A made-up bike shop, structure only:

\`\`\`
Launch: same-day repairs
Page: /same-day
Before: email list on day minus 14, two posts showing the new workbench
Day: site page, email, Instagram and Facebook posts, pinned
After: post with the first week's most common repair, note in the newsletter

Post:
Drop your bike off before 10, ride it home after 5. Same-day repairs start Monday for flats, brakes and gears. Book a slot: [link]
\`\`\`

## Release notes

For an app or online service, keep a dated list of changes. Write each line as "You can now ___" or "___ is faster / fixed". Group by New, Better, Fixed. Leave out anything customers cannot see or use yet.

## Product Hunt (only for an app or online tool)

Worth it only when the buyers are early tech users. Prepare a clear one-line tagline, a few screenshots and a short demo. On the day, the owner answers every comment and sends visitors to the launch page to sign up. Treat it as one extra day of attention, not the launch itself.

## Deliver it as

What is new in one sentence, the launch page, then a dated list of steps (when, where, what), then the drafts. Facts from the Brand Brain or the owner only; when proof is missing, say what to ask early users for. Words follow \`brand-voice\`.`,
    checklist: [
      {
        rule: "It states what is new in one sentence a customer would say.",
      },
      {
        rule: "Every message sends people to one page on the business's own site.",
      },
      {
        rule: "The business's own email list and site come first on launch day, then the social networks.",
      },
      {
        rule: "Each step has a date or day and the place it goes out.",
      },
      {
        rule: "Every date, price, limit and customer quote comes from the brand facts or the owner.",
      },
      {
        rule: "The launch-day post opens with what is new and who it is for.",
      },
    ],
  },
];
