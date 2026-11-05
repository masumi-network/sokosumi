import type { WritingSkill } from "./types.js";

export const SOCIAL_WRITING_SKILLS: readonly WritingSkill[] = [
  {
    id: "x",
    group: "social",
    name: "X",
    description:
      "Read before any X post: one sharp thought, short, the link in the reply.",
    channels: ["x"],
    content: `# X

X is fast and conversational. People read one line and decide. A good post is one sharp thought someone wants to reply to or repost.

## What works

- One idea per post. If you have two, that is two posts.
- Short: most good posts are one to three lines, well under the limit. The account's limit is in \`list_project_social_accounts\`; a standard account allows 280 characters.
- Concrete beats clever: a number, a name, a before and after.
- Write to start replies: take a position, share a result, ask a question people can answer.
- A native image beats a link preview. Keep links out of the post.
- At most 2 hashtags, only when they name a topic people follow. Usually none.
- No thread unless each part adds something new. A thread is a list of strong posts, not one post cut into pieces.

## Formats

**post**: one to three lines. A line break between the claim and the detail is fine; a blank line before a closing question is fine. No list.

**reply** (a post with a first reply): the post makes the point and works on its own. The first reply (firstComment) carries the link or the next point, and the post ends by saying where it is ("Link below."). The reply is one or two lines.

**image**: the text says what the image does not. Never describe the image ("Here is a photo of our new mug"); say why it matters ("The mug that survived 400 dishwasher runs in our test.").

## Example shapes

Made-up businesses, structure only:

\`\`\`
We raised our prices 20% and lost 3 clients out of 60.

The 57 who stayed now get a reply within an hour. That was the whole point.
\`\`\`

\`\`\`
The fastest way to price a logo project: ask what the logo is worth to them, then halve it.

The guide we use with every client is in the reply.
\`\`\`

## Never

- "🧵 Thread:" or "1/" openings, "A thread 👇"
- More than one question
- Hashtags inside the sentence
- A link in the post body`,
    checklist: [
      { rule: "One idea, in one to three short lines." },
      { rule: "Concrete: a number, a name, a result or a clear position." },
      { rule: "No 'Thread:', '1/' or emoji-pointer openings." },
      {
        rule: "Reply format: the post works on its own and says where the reply is ('Link below.').",
        formats: ["reply"],
      },
      {
        rule: "Within the account's character limit; no link in the post body; at most 2 hashtags.",
        counted: true,
      },
    ],
  },
  {
    id: "linkedin",
    group: "social",
    name: "LinkedIn",
    description:
      "Read before any LinkedIn post: a hook before 'see more', short paragraphs, a lesson from experience.",
    channels: ["linkedin"],
    content: `# LinkedIn

LinkedIn rewards posts that teach something from real experience: a lesson, a result, a decision and why. People read on a phone at work. They see about two lines (roughly 140 characters on mobile) before "see more".

## What works

- **The first two lines are the hook.** They must make someone tap "see more". Put the most surprising true thing there.
- **Short paragraphs**: one or two sentences, a blank line between each. Never a block of text.
- **Experience over advice**: "We tried X, this happened, here is what we do now" beats "5 tips for X".
- **One idea**, taken all the way: what happened, why, what the reader can take from it.
- **End with a question or a one-line takeaway.**
- **Length**: a text post reads best at 800 to 1,500 characters. Shorter is fine when the idea is done.
- **Links** go in firstComment; the post can say "Link in the first comment."
- **Hashtags**: 3 to 5 specific ones on the last line, or none.

## Formats

**post** (text): the full shape below, no picture.

**image**: the image carries one thing (a chart, a product, a moment); the text is shorter, 400 to 900 characters, and says what the image means. The first line still hooks without the image.

**images** (two to four images): one story told across the images, one idea per image. Choose its shape first: a step-by-step walkthrough, a problem then the proof, a list of tips, a before and after. The first image works on its own; there are exactly as many images as it promises. The text introduces the story in a few short paragraphs and tells people to swipe ("Swipe through the four steps.").

**video** (short vertical video): the point in the first second, one idea. Most people watch muted, so the text carries the words: two to four short lines with the hook, what the video shows, and why it matters.

## Shape of a text post

\`\`\`
[Hook: the surprising true thing, one or two lines]

[Context: what was going on, one or two sentences]

[What happened or what we tried]

[The turn: what we learned, the number, the decision]

[What the reader can take from it, maybe a short list]

[Closing question or one-line takeaway]

[#Tag #Tag #Tag]
\`\`\`

## Example shape

A made-up bakery, structure only:

\`\`\`
We stopped baking 40 kinds of bread. Sales went up 18%.

For years we thought choice was the point. Every morning, 40 kinds on the shelf.

Then we looked at the numbers. Six breads made 80% of the sales. The other 34 made waste.

So we cut to 12. The bakers had time to do each one properly, and the queue moved faster.

What we learned:
- People come for the bread they love, not for the choice
- Fewer products means better products
- Waste is a number you can read every evening

What would you stop making if you looked at your numbers?

#SmallBusiness #Bakery #Retail
\`\`\`

## Never

- "I'm excited to announce", "I'm humbled", "Let that sink in."
- One-word lines for drama
- "Agree?" or "Thoughts?" as the ending
- Tagging people or companies who are not in the story
- A link in the post body`,
    checklist: [
      {
        rule: "The first two lines (about 140 characters) are a hook that makes people tap 'see more'.",
      },
      {
        rule: "Short paragraphs of one or two sentences with blank lines between them.",
      },
      {
        rule: "It is built on one real experience, result or decision, not generic tips.",
      },
      {
        rule: "It ends with a question or a one-line takeaway, not 'Agree?' or 'Thoughts?'.",
      },
      {
        rule: "Multi-image post: the text introduces one story told across the images and tells people to swipe.",
        formats: ["images"],
      },
      {
        rule: "Text post at most about 1,500 characters, image or video post about 900; no link in the body; 3 to 5 hashtags or none.",
        counted: true,
      },
    ],
  },
  {
    id: "instagram",
    group: "social",
    name: "Instagram",
    description:
      "Read before any Instagram post: the picture leads, the caption's first line stops the scroll, people save and share.",
    channels: ["instagram"],
    content: `# Instagram

On Instagram the picture or video does the stopping; the caption makes people stay, save and share. People see the first line (about 125 characters) before "more". Captions are searchable, so the words people search for belong in the first sentence.

## What works

- **First line**: one line that adds to the picture. Name the topic in words people search for (the product, the place, the problem).
- **Saves and shares** are what Instagram rewards: make posts worth keeping (a how-to, a list, a recipe, a look behind the scenes).
- **Short paragraphs** with blank lines; a list is fine.
- **End with one call to action**: save this, send it to someone, comment with a word, visit the link in bio.
- **Links are not clickable** in captions. Never paste a URL; say "Link in bio."
- **Hashtags**: 3 to 5 specific ones on the last line. Never a wall of tags.
- **Emoji**: follow the voice; when it says nothing, at most one.

## Formats

**image**: a caption of 2 to 6 short paragraphs. The first line says what is interesting about the picture, not what it shows.

**quote_card**: the card holds one line people want to save or share, 6 to 15 words, in the brand's voice, with no hashtags and no logo talk. The caption gives the context in two or three lines and asks people to share it with someone who needs it.

**carousel** (3 to 10 slides): one idea per slide, a few words each, readable in two seconds. Choose its shape first: a step-by-step walkthrough, a problem then the proof, a list of tips, a before and after.
- Slide 1 is the hook: a promise or a question ("5 mistakes that make bread dense"), and there are exactly as many slides as it promises.
- The middle slides deliver, one point each, in the same layout.
- The last slide closes: the takeaway and one action ("Save this for your next bake.").
- The caption repeats the hook in words and adds what the slides cannot.

**reel** (short vertical video): the point in the first second; most people watch muted, so put the key words on screen. The caption is one to three lines: the hook, the keywords, one action.

## Example shape

A made-up flower shop, structure only:

\`\`\`
Tulips keep growing after you cut them. That is why they lean.

Three things that keep them standing:
- Cut 2 cm off the stems every second day
- Cold water, never warm
- A tall vase that holds two thirds of the stem

Save this for the next bunch you buy.

#Tulips #FlowerCare #CutFlowers
\`\`\`

## Never

- A URL in the caption
- More than 5 hashtags, or hashtags in the middle of a sentence
- A caption that only describes the picture
- "Link in bio" when the brand has no link in bio for this (check the Brand Brain)`,
    checklist: [
      {
        rule: "The first line adds to the picture and names the topic in words people search for.",
      },
      { rule: "Short paragraphs with blank lines, worth saving or sharing." },
      { rule: "It ends with one call to action." },
      {
        rule: "Carousel: the caption repeats the slides' hook in words and adds what the slides cannot.",
        formats: ["carousel"],
      },
      {
        rule: "Quote image: the caption gives the line's context in two or three lines and asks people to share it.",
        formats: ["quote_card"],
      },
      {
        rule: "No URL in the caption; 3 to 5 hashtags or none.",
        counted: true,
      },
    ],
  },
  {
    id: "facebook",
    group: "social",
    name: "Facebook",
    description:
      "Read before any Facebook post: short and neighbourly, something people answer in a comment.",
    channels: ["facebook"],
    content: `# Facebook

Facebook is people talking to people they know. Posts that reach far are short, warm, and ask something people can answer from their own life. Local businesses do especially well when they sound like a neighbour.

## What works

- **Short**: the point in the first line or two, before "See more". Many of the best posts are under 80 characters plus a picture.
- **Conversational**: write the way the owner would talk to a regular customer.
- **Ask something easy to answer**: a choice, a memory, an opinion ("Sourdough or rye for the weekend?").
- **Pictures and video** reach far more people than links.
- **Links** go in firstComment ("Link in the comments.").
- **Hashtags** add little: at most 3, usually none.

## Formats

**image**: one to four short lines about the picture, ending with a question or an invitation.

**link** (a post that sends people to the site): the post gives the reason to click in one or two lines; the link itself goes in firstComment, and the post says so. The post still works for someone who never clicks.

**reel** (short vertical video): one or two lines: the hook and why it matters to the people who follow the page.

## Example shape

A made-up bike repair shop, structure only:

\`\`\`
Saturday's free puncture class is full again. We added a second one on Sunday at 10.

What should we teach next: brakes or gears?
\`\`\`

## Never

- Long essays (that is LinkedIn's shape, not Facebook's)
- "Like if you agree, share if you care", "Tag a friend who..."
- A link in the post body`,
    checklist: [
      { rule: "Short: the point in the first line or two." },
      { rule: "Conversational, like talking to a regular customer." },
      {
        rule: "It asks something people can easily answer, or invites them to something.",
      },
      { rule: "No engagement bait ('Like if', 'Tag a friend')." },
      {
        rule: "Link post: the post gives the reason to click and says the link is in the comments.",
        formats: ["link"],
      },
      { rule: "No link in the body; at most 3 hashtags.", counted: true },
    ],
  },
  {
    id: "youtube",
    group: "social",
    name: "YouTube Shorts",
    description:
      "Read before any YouTube Short: a title that names the viewer's question, a short searchable description.",
    channels: ["youtube"],
    content: `# YouTube Shorts

A Short is found two ways: in the Shorts feed, where the video does the work, and in search, where the title and description do. YouTube takes the post's text as the title and description: the first line is the title, the rest is the description.

## Title (the first line)

- Name the viewer's question or the task, in plain words people search for: "How to fix a slow puncture in 60 seconds".
- About 40 to 70 characters. Long titles are cut off on phones.
- No clickbait, no ALL CAPS, at most one emoji and only when the voice uses them.

## Description (the lines after it)

- First line of the description: what the video shows, with the main keyword.
- One or two more short lines: why it matters, and one action (subscribe, visit, watch the full guide).
- Links are fine here, each on its own line.
- 3 to 5 relevant hashtags on the last line; #Shorts is allowed as one of them.

## Example shape

A made-up bike repair shop, structure only:

\`\`\`
How to find a slow puncture in 60 seconds

The water bowl trick our mechanics use on every tyre.

No bowl? A spray bottle with soapy water works too.

#BikeRepair #Cycling #Shorts
\`\`\`

## Never

- A title that does not say what the video is about
- Paragraphs of text: the viewer is here for the video`,
    checklist: [
      {
        rule: "The first line is a title that names the viewer's question or task in the words they search for.",
      },
      {
        rule: "The description's first line says what the video shows, with the main keyword.",
      },
      { rule: "It stays short: the video carries it." },
      {
        rule: "A title of about 40 to 70 characters; 3 to 5 hashtags on the last line.",
        counted: true,
      },
    ],
  },
  {
    id: "tiktok",
    group: "social",
    name: "TikTok",
    description:
      "Read before any TikTok caption: one or two lines with the words people search for.",
    channels: ["tiktok"],
    content: `# TikTok

On TikTok the video is the post. The caption helps search and gives people a reason to watch to the end or comment.

## What works

- One or two short lines.
- The words people search for, naturally: the product, the problem, the place.
- A hook or a question that makes people watch to the end or answer ("Wait for the last cut.").
- 3 to 5 hashtags: the niche topic and one broader one.
- Links are not clickable in captions; never paste a URL.

## Example shape

\`\`\`
The 10-second fix for a wobbly table. Wait for the last step.

#DIY #FurnitureRepair #HomeHacks
\`\`\`

## Never

- Long captions
- A URL
- Hashtags unrelated to the video`,
    checklist: [
      { rule: "One or two short lines with the words people search for." },
      { rule: "A hook or question that makes people watch or comment." },
      { rule: "No URL; 3 to 5 relevant hashtags.", counted: true },
    ],
  },
];
