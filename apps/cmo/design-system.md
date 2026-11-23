# CMO.XYZ design system

The visual system for app.cmo.xyz: **neobrutalism** on the Masumi palette, the same look as the CMO.XYZ landing page. Masumi brings the palette (neutrals, PP Mori, one pink); Cuso brings the outline (thick ink lines and hard shadows). It should read like a serious tool with a loud, friendly face.

- **Voice, product, agent naming:** [`DESIGN.md`](DESIGN.md). This file covers how things look.
- **Source:** the concept canvas https://claude.ai/artifact/9mWPtBgNY9HQ8wLXcadZk4 (boards Vibe, Site, Reading, Brand, Plan, Launch, Home, each with a dark version). Since 2026-11-17 the app follows the landing page's look (thick lines, larger hard shadows, pills), which the canvas does not show. Where a board and this file disagree, this file wins.
- **Family:** colours follow the [Masumi Family brand guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide). CMO is its own product: never Sokosumi chrome, names or wording.
- **Tokens:** values live once, as CSS custom properties in `src/app/globals.css`. Components read tokens, never literals. `src/design-guards.test.ts` enforces the rules below; `src/components/phone-feeds.css` is exempt because it draws the networks' own UIs.
- **Preview:** `/design-system` (local and preview deploys) renders the tokens and components in both themes. The onboarding parts (step markers, checklist, question card, tile, side panel, assumption chip, goal block, avatar sizes) and Cuso's states as the sidebar shows them sit under Components; `/design-system/onboarding/<screen>` (hire, reading, writing, asking, brand, plan, planning, launch, launch-connected, subscribe, subscribe-confirming), `/design-system/app/<view>` (today, chat, strategy, calendar, seo, results, competitors, brain, channels, settings; competitors also takes `?state=empty` and `?state=loading`, every view `?state=busy`, a month of 150 posts, and `?state=quiet`, no posts, nothing that needs the owner and a long business name) and `/design-system/pages/<page>` (signed-in, invite-only, sign-in-problem, name-setup, error) render each real screen over fixture data (`?theme=dark` pins the theme). The Logo section shows every lockup in use.
## Five rules

1. **One line does the work.** A 3px ink line on every outlined thing: cards, panels, frames (Cuso's picture too), inputs and full-size buttons. 2px on chips, tags, badges, small buttons and avatar circles. A 1px hairline only for structure inside a card: dividers, list rows, inner items. The landing page uses the same two widths.
2. **A hard shadow means you can act.** An offset with no blur, in two sizes and nothing above 6px. 4px under anything you can click, type in or pick: buttons, chips, inputs, the account card, the page you are on, and every one of a set to pick from (each tab, filter, pace and plan, picked or not). 6px only under the hire screen's button and the post that is open on the Calendar. What you cannot click has its line and no shadow, even when it needs the owner: every card and panel, Cuso's scene, report and message cards, tags, badges, labels, images (`design-guards.test.ts` holds this). The buttons inside a card carry the shadow.
3. **Iris means now, and picked.** The primary button, the current step, and the picked one of a set (a tab, a filter, a plan). The sidebar's page you are on is a white card instead (see Sidebar), because Cuso's stage under it is Iris. The fill alone says which one is picked: the others keep their shadow, so each still reads as a button. Never text, never a thin mark. Text on Iris is always Neutral 950.
4. **Bold speaks, Regular works.** One PP Mori SemiBold H1 per screen, tracked at -0.03em. Regular for statements, big numbers and UI, SemiBold for buttons, pills, labels that lead and section heads. Mori ships two cuts: weights 300 to 500 draw Regular, 600 to 800 draw SemiBold.
5. **Black strips for contrast.** White page, outlined panels and cards, and a black strip where the page needs weight: the action bar at the bottom of an onboarding step, a banner that needs the owner, the goal block. A strip inverts in dark.

## Colour

| Token                  | Role                                | Light            | Dark             |
| ---------------------- | ----------------------------------- | ---------------- | ---------------- |
| `--background`         | page                                | `#FFFFFF`        | `#0C0C0C`        |
| `--surface`            | panel (gray layer, sidebar)         | `#F5F5F5`        | `#171717`        |
| `--card`               | card on a panel                     | `#FFFFFF`        | `#0C0C0C`        |
| `--foreground`         | text                                | `#171717`        | `#FAFAFA`        |
| `--muted`              | secondary text                      | `#525252`        | `#A3A3A3`        |
| `--line`               | ink line and hard shadows           | `#0C0C0C`        | `#FAFAFA`        |
| `--border`             | hairline                            | `#E5E5E5`        | `#262626`        |
| `--primary`            | Iris Flower                         | `#FF51FF`        | `#D141D1`        |
| `--primary-hover`      | Iris on hover                       | `#FF51FF`        | `#FF51FF`        |
| `--primary-foreground` | text on Iris, green, yellow         | `#0C0C0C`        | `#0C0C0C`        |
| `--peach`              | Peach Blossom, behind Cuso only     | `#FFC8F0`        | `#FFC8F0`        |
| `--ok`                 | done                                | `#00D43B`        | `#00D43B`        |
| `--warn`               | needs an answer                     | `#FFD300`        | `#FFD300`        |
| `--net-*`              | a post's network (Today, Calendar)  | light tints      | same as light    |
| `--shadow`             | anything you can click or type in   | `4px 4px 0` ink  | `4px 4px 0` ink  |
| `--shadow-big`         | the open Calendar post, hire button | `6px 6px 0` ink  | `6px 6px 0` ink  |
| `--shadow-iris`        | second button on a strip            | `4px 4px 0 Iris` | `4px 4px 0 Iris` |
| `--strip`              | the black strip                     | `#0C0C0C`        | `#FAFAFA`        |
| `--strip-foreground`   | text and lines on a strip           | `#FFFFFF`        | `#0C0C0C`        |
| `--stage`              | Cuso's avatar circle                | `#F5F5F5`        | `#F5F5F5`        |
| `--scrim`              | behind a modal sheet only           | black at 30%     | black at 30%     |

- **Iris is the one accent.** The primary button, the current step and the picked item. Peach appears only behind Cuso, never next to an Iris surface.
- **Dark Iris rests at `#D141D1`** and goes to `#FF51FF` on hover (approved for CMO 2026-11-04; the Masumi guide still says Iris is the same in both themes).
- **Green, yellow and Iris are fills only**, under a Neutral 950 glyph. On white they measure 1.4 to 2.7:1, so they never carry text or a thin mark.
- **Channel marks** keep their networks' colours (`--mark-*`); they are logos, not palette.
- **Network fills** (`--net-linkedin`, `--net-x`, `--net-facebook`, `--net-instagram`, `--net-youtube`, `--net-tiktok`, `--net-newsletter`, `--net-seo`, `--net-ads`; the `.net-<channel>` classes) are light, solid tints of each network's colour under a Neutral 950 glyph, the same in both themes, so a week of posts tells its networks apart at a glance. Like Iris, green and yellow they are fills only, never text or a line. They mean the network and nothing else.
- No gradients, no glow, no blur, no transparency washes. The scrim behind a modal sheet is the one see-through colour.

## Type

PP Mori, through `--font-sans` (`mori-regular.woff2` and `mori-semibold.woff2` in `public/fonts`, loaded in `src/app/layout.tsx`). The one other face on screen is content: the Brand Brain's "Your look" sets each of the brand's font names in that font where the device has it (`FontNames` in `brand-look.tsx`, the guard's one exception), and shows the brand's colours as discs, never as hex codes in a row. Numbers that compare use `font-variant-numeric: tabular-nums`.

| Step      | Size / line | Weight     | Tracking | Use                                  |
| --------- | ----------- | ---------- | -------- | ------------------------------------ |
| display   | 72 / 68     | 600        | -0.03em  | Site hero only                       |
| headline  | 44 / 46     | 600        | -0.03em  | an app page's lead, Today's greeting |
| h1        | 36 / 38     | 600        | -0.03em  | the one screen title                 |
| statement | 28 / 32     | 300        | -0.01em  | a promise, the plan goal             |
| value     | 24 / 28     | 300        | -0.005em | tile values, big numbers, a question |
| h2        | 16 / 20     | 600        | 0        | card and panel heads                 |
| body      | 14 / 18     | 400        | 0        | UI text; 500 for labels, 600 buttons |
| small     | 12 / 16     | 400 or 500 | 0        | meta, field help, step markers       |
| micro     | 11 / 14     | 400 or 500 | 0        | sources, tags                        |

Inputs use 16px text so iOS does not zoom. Sizes are rem in code.

## Shape and space

- **Line:** `--line-width` 3px and `--line-width-small` 2px, and the 1px hairline inside a card. No other border width.
- **Radius:** one small scale, the same on the landing page: 8px small marks (checkboxes), 12px controls (buttons, inputs, nav rows), 20px cards, panels, sheets and Cuso's stage. `--radius-pill` (fully round) for tags, badges, step markers, tabs, filters, chips and the tilted labels. No 28px panel radius any more.
- **Space:** a 4px grid. Page padding 32px (16px under 768px). Panel padding and gap 12px. Card padding 16, 20 or 24px. Sections stack 24 to 48px apart.
- **Width:** onboarding is one centred column, 640px (the hire screen 820px for its headline); the open full plan widens to 1120px for its calendar. An app page is one column up to 1040px (the chat's 880px), centred in the main area with the same space on both sides (`--page-pad`, at least the page's 48px). Cuso's hand reaches only a few pixels past the sidebar into that space, so no gutter is kept for him (`--gutter` is 0; a design guard holds the reach).
- **Breakpoints:** layouts are `flex-wrap` with min widths, so they reflow without media queries. Under 768px everything is one column and the side panel becomes a bottom sheet.

## Elevation and motion

- Hard shadows are the only elevation, in two sizes, and only on what you can act on. Every button, chip and input casts the 4px shadow, and so do the account card, the page you are on and every tab, filter, pace and plan of a set, picked or not. The 6px shadow marks the hire screen's button and the post that is open on the Calendar, which is a button. A post card on the Calendar takes the 4px shadow on hover. Every card that is not itself a button is flat, whatever it holds: the question card, the Launch accounts list, an approval waiting, a source or network not connected. Tags, badges, labels, pictures, Cuso's stage, sheets, report cards and info cards are flat too.
- An inset 1px hairline (`inset 0 0 0 1px`) is a line, not a shadow, and is allowed where a border would shift layout.
- **Pressed:** the shadowed element moves right and down by its own offset (4px, or 6px for the hire button) and drops its shadow, as if pushed flat.
- Transitions are 150ms on colour and transform only, off under `prefers-reduced-motion`. Onboarding adds three entrances, transform and opacity only: each piece of a step settles in after the one above it (450ms), a sheet rises from the bottom (400ms), and Cuso pops in.

## Components

**Logo.** Approved lockups from the Masumi Family Brand Guide (`Logo` in `src/components/logo.tsx`, files copied unchanged into `public/logo/`), each only on the background the guide approves for it: the file for white on a light page, the file for black on a dark page. Never recoloured, stretched, outlined or given a shadow; a lockup with the mascot is never narrower than 120px. Only `Logo` names the files.

| Lockup  | Where                                       | Light page                 | Dark page            |
| ------- | ------------------------------------------- | -------------------------- | -------------------- |
| Stacked | the header, 46px tall (121px wide)          | `stacked-text-black`       | `stacked-text-white` |
| Primary | beside the lead of the pages around sign in | `mascot-top-outline-black` | `mascot-top-white`   |
| Framed  | the 404                                     | `framed-black`             | `framed-white`       |
| Block   | the error page ("Something went wrong.")    | `block-black`              | `block-white`        |

A page that leads with a lockup (the hero pages) hides the header's, so one logo shows at a time: 440px wide beside the copy, 220px above it on a phone. The knockout block's letters are the page showing through, which is why it sits only on the page colour. The favicon and app icon are the guide's Iris monogram. The guide's lockups on Iris stay out of the app until a page puts a logo on an Iris surface.

**Header (onboarding).** Logo left, step markers centre, the site chip right (a pill: green 8px dot with a line edge, then the domain). A 3px ink line below, 14px 32px padding.

**Step marker.** One calm row, small 600, "1 Research". Only the current step is a pill: Iris fill, 2px ink line, `aria-current="step"`, flat as a label. Done and not yet are the same plain label with no line: a check and the text colour, or the number and muted text. A step that goes back to its screen is a link: its name underlined, a panel fill on hover, no line and no shadow, so it is never heavier than the step you are on. On a phone, where only the current step keeps its name, a step to go back to stands on the panel fill instead. Five steps: Research, Brand, Plan, Subscribe, Launch.

**Buttons.** 44px high, 12px radius, body 600, 0 18px.

- Primary: Iris fill, 3px ink line, Neutral 950 text, 4px hard shadow, trailing arrow. One per screen; its label is the screen's question ("Start reading", "Looks like us", "Approve plan", "Launch {agent}"). On the hire screen it takes the 6px shadow.
- Secondary: card fill, 3px ink line, 4px hard shadow.
- Small: 32px high, 12px text, 2px ink line, 4px shadow; Iris fill when it is the picked item ("Open").
- Text: underlined muted 12px, 32px tap height ("Skip, decide on the plan").
- Disabled: flat, hairline colour, no shadow.
- On a strip: the line and shadow take the strip's text colour; a secondary button stands on an Iris shadow.

**Pill.** Chips, tabs and filters: fully round, 2px ink line, card fill, 12px 600 text, and the 4px shadow, because you click them. A tag is a label ("Big move", "Partly backed", a date, a kind): fully round, a flat panel fill with a hairline, 12px 500 text, no ink line and no shadow, so it never reads as a button. A count is an ink pill with inverted text. Where a post or campaign stands (Written, Scheduled, Running, Didn't go out) is not a pill: small muted words beside a mark (`.state`), so it never reads as a button. A post a network refused or that missed its time reads "Didn't go out" beside the failed disc; the open post adds the reason Core gives (`notSent`). A post our network app was paused on (X's monthly spend cap, ours to raise) stays scheduled and reads "Retrying" beside the clock, with "X paused our posting for now; Cuso will try again." in the open post; it never asks the owner to raise a cap and is not a "Needs you" row.

**Input.** 44px, 12px radius, 3px ink line, 4px hard shadow, 16px text, card fill. Label above (body 500), help below (small, muted). The chat's composer is one input: one line and one shadow around its textarea.

**Selection.** Every one of a set to pick from is a button at rest: card fill, its ink line and the 4px shadow (tabs, filters, chips, the plan cards). The picked one is the same button filled with Iris under Neutral 950 text. Never a shadow on the picked one alone: a flat outline beside it reads as a label (`design-guards.test.ts`, "every choice reads as a button"). One that cannot be picked now is disabled: flat, hairline colour. The sidebar is a list of pages, not a set of buttons: its rows are plain and the page you are on is a white card with the 3px line and the shadow.

**Plan card (Subscribe).** Under Cuso's scene, the lead and a row of the month's networks as their marks (no counts), a Monthly / Yearly switch, a size up from other tabs (40px, 14px text): a pair of pills, the picked one on Iris, Yearly carrying the saving as an ink count pill ("Save 17%"). Then the CMO plans of that interval as cards: a flat "Makes all of it" mark on the smallest plan that makes the whole strategy, the tier's name, the price a month (value step; a yearly plan shows the monthly price struck through above it and "$2,000 billed yearly" under it), and one plain line of how much of the month it makes ("Makes about 60% of your month."; no post, picture or video counts); the top plan adds the team check. Every plan card casts the 4px shadow and the picked one is filled with Iris. One primary button below names the plan and its price ("Start Growth for $500 a month") and leads to Polar's hosted checkout; one small centred line under it carries "Cancel any time." and the legal links (Terms, Privacy, DPA, Imprint). Testers on Core's skip allowlist also see "Continue without a subscription (testers)".

**Card.** Card fill, 3px ink line, 20px radius, flat. Only a card that is a button casts a shadow: the open Calendar post takes the 6px one (`button.card-focus`), and a tile to pick in a grid casts the 4px shadow, filled with Iris once picked. A panel (a section of an app page, a fold, a tab panel, a group of tiles) is the same line and radius.

**Funnel (Strategy).** One shape that narrows toward the sale, a slice a stage: each slice starts as wide as the one above ends, with a 3px ink line and a flat fill (card, Iris, yellow, and green for the last stage, the sale), and holds the stage's number, its classic name (Awareness, Interest, Desire, Action) and what people do there in Neutral 950 (text colour on the card slice). The funnel is the one place Iris, yellow and green are fills for a picture and mean neither picked nor a status. Beside each slice, under it on a phone: the stage's goal (value step) and the same three answers at every stage, so they line up down the page: What Cuso does (his own sentence, then one line a channel), What you do (the owner's sentence, and at the sale Cuso's ideas for their pages), and How we know it works (the number, today's value in the value step only when it is a figure of five words at most, a sentence as plain words, and a green disc when it is measured or "Cuso's estimate" when it is not). Nothing is pressed and nothing folds.

**Number.** A count to read (Results, SEO) is a small muted label over the value step, with no box: an outlined box reads as a field to type in. The month's post count is one number everywhere: the posts that go out (what the plan bought makes, `monthMade`), on Today, the Calendar, the chat's month card and Cuso's pill. Strategy, which shows the month as written, says "171 planned, 169 in your plan" when the plan makes fewer.

**Calendar weeks.** The month opens on this week: its head carries an Iris "This week" label (flat, a 2px line), a post going out today says "Today" on an Iris fill where its day stands, and a post without a picture shows its opening words on its network's fill (`.net-<channel>`), so a week reads by network at a glance. On a phone, one card a row, those words take their own height instead of a picture's.

**Results charts.** Until the networks report reach, the numbers that exist are the month's own: "This month" is Today's bar, and "By network" draws one bar per network, as long as its share of the month's posts, outlined with the 2px line, filled in the network's colour for the posts already out ("2 of 5"). Longest first. Bars grow from the left (off under reduced motion). Charts are pictures: no shadow.

**Post (Calendar sheet).** A social post as it will look on its network: a hairline card with the business's mark, name, handle and time, the network's mark at the right, the words, then the picture or video (Instagram: picture first). Flat. Under it, where the post stands (`.state`) on the left and "Edit text" (a small secondary button) on the right; editing swaps the words for an input and Save / Cancel.

**Tile.** A row in one outlined gray group, hairlines between: label (small 500, muted), value (16px 500, one line), one line of detail (small, muted), chevron right. Tap opens the row's sheet, which carries the source.

**Side panel.** A sheet that rises from the bottom of the screen, as wide as the column: h2 title, 32px close button with the small line and the 4px shadow, short summary, hairline-separated list, source link, and a "Tell {agent} what's off" input.

**Question card.** Progress as 10px pill segments with a 2px ink line (done: text fill; current: Iris; next: empty). Topic (small, muted), question (value step), "Why I ask" line with an info icon, then Yes / No / Not sure as secondary buttons in three columns, and a text button to skip.

**Checklist.** 20px boxes, 8px radius, 2px line. Done: green fill, ink line, check. Working: dashed ink line with a dot. Not yet: hairline colour.

**Skeleton.** Dashed hairline box with hairline bars. Never a shimmer.

**Assumption chip.** Sits on the line it changes (the budget, a move): panel fill, a 20px yellow disc with a Neutral 950 "!", the question, a small Yes button and a text alternative ("Change", "No").

**Goal block.** The plan's goal: an ink block with inverted text that inverts again in dark, 20px radius, statement step.

**Sidebar (CMO home).** Panel fill, a 3px ink line on its right, 280px wide (`--side-width`). On top, the Business as a menu button (`BrandMenu`): its mark (36px), its name, its site and a chevron. It opens a menu (`role="menu"`, Arrow keys, Home and End move, Escape closes and gives focus back, a press outside closes) with the brand's pages, Strategy, Brand Brain, Competitors, SEO and Channels (the open one marked with an Iris dot), and "Open <site>" under a hairline. While one of those pages is open the button reads as the page you are on: a white card with the 3px line and the 4px shadow. At the right the person's avatar: 36px round, their picture or their initial on a light disc with the 2px line, no shadow; a menu button, so it takes a hairline-grey halo on hover and while open, Iris while Settings is open, and the 2px focus ring, which opens the account menu: who is signed in, Settings, Your Cusos (when there is another), the theme and Sign out. Then the daily pages, text only, as 48px rows: Today (with its count), Chat, Calendar and Results; 12px radius, the page you are on a white card with the 3px line and the 4px shadow. Counts are ink pills, micro text. At the foot, Cuso's Iris stage (see Cuso). On a window under 820px tall the rows tighten (40 and 34px) so the stage keeps room.

**Page lead.** Every app page but Today and Chat opens with the same light lead (`PageLead`): a small muted kicker that names the page and what it reads from ("SEO · audit of acme.io, 16 Nov"), then the headline in the headline step that states the answer ("2 changes to make.", "1 post waits for you.", "Numbers start Monday."), then at most one line. What belongs beside it (Strategy's approval) sits at its right. Strategy's goal is its headline, under the kicker. The chat has no lead: the thread starts at the top. The headlines come from the data (`lib/page-lead.ts`), never a fixed title.

**Today (home).** One column that fills the screen, top to bottom: the greeting in the headline step and one line in the value step; "This month", one outlined card with its head and Results, one bar of pills with a 2px line, green out, Iris scheduled, yellow written, panel to make, and ink for posts that didn't go out (only when one did), with a legend of discs; "This week", seven columns in one outlined panel that takes the height left, today filled with Iris (`aria-current="date"`); a day counts its posts per network as small pills on the network's fill (mark and number, 1px line), then shows its first three posts as small buttons on their network's fill (mark and title in two lines), each opening its sheet on the Calendar; "+N more" or the day's date opens the rest of that day in place. Last, at the bottom where the sidebar's Cuso points, "Needs you" as one yellow card with a row each (an outlined "!" disc, the thing in body 600, one line, its button: the first row's is the screen's primary button, the rest small secondary), every network posts wait for in one row, posts that didn't go out in one row whose button opens the first on the Calendar, and nothing at all when nothing waits (the line under the greeting says so). On a window under 820px tall the pieces tighten so "Needs you" stays in view at 1280 by 720. On a phone the week is a row of seven dates (each with its post count, one of a set to pick, so each casts the 4px shadow and the picked one is Iris; today's number is underlined) over the picked day, today until another is tapped, with its posts one line each with the time. The pieces settle in one after another and the bar grows from its left (transform and opacity only, off under reduced motion).

**Tab bar (phone).** Under 861px the sidebar gives way to a top bar holding the same brand menu, and a bar at the bottom, within the thumb's reach: Today (with its count), Chat (Cuso's face on his light disc), Calendar, Results and More, each an icon over a micro label, with a 3px ink line on top and the panel fill. The page you are on fills its icon's pill with Iris and the 2px line; a page under More marks More. More opens a card above the bar, anchored to it, with SEO, Settings, Your Cusos, the theme and Sign out (the brand's pages open from the top bar); it closes on a pick, a press outside or Escape. A tab gives under the thumb at once (the pill scales to 92%). Nothing in the bar casts a shadow: it is navigation, like the sidebar's rows.

**Strip.** A black band with white text that inverts in dark (`--strip`, `--strip-foreground`): the action bar at the bottom of an onboarding step and the banner that says Cuso is paused or out of credits.

**Working and "How I got here" (chat).** While Cuso works, his row shows the step he is on (body 500, beside the three working dots) and the model's latest reasoning under it (small, muted, two lines at most). Under a reply, "How I got here" is a fold: a muted small row with a chevron, opening to the steps and the reasoning behind a hairline on the left. Both are flat with no ink line: nothing here is pressed but the fold's row. On a phone the suggestion chips over the composer keep to one row that scrolls sideways, so the thread keeps its room.

**Status.** Done: green disc, Neutral 950 check. Needs you: yellow disc, Neutral 950 "!". Failed or blocked: Neutral 950 disc, white X. Live: green dot with a line edge.

## Cuso

- **Cuso is the status.** He is the brand guide's 2D Cuso (`Cuso 2D Mascot`), flat black line on white, as SVGs in `public/cuso/` built by `scripts/cuso-poses.py`: walking, friendly, pointing, thinking, researching and done (his check mark). No PNGs. Poses map to states: Needs you (pointing; whenever anything waits on the owner), Reading (researching), Thinking (thinking), Reporting (friendly, waving), Done (done).
- **One big Cuso on every app page.** He stands at the foot of the sidebar on an Iris stage (up to 440px tall, a 3px line on top), in a spotlight: a light pool on the stage's floor (`--stage`, up to 240px wide, no line) and a faint flat beam falling on it from the stage's top. He stands in the pool, his feet on its middle line, and every pose stays inside the sidebar (`design-guards.test.ts` measures each pose in `poses.svg`); the stage clips him. Pool and Cuso grow and shrink with the room the stage has and step out, leaving the pill, when it has under 200px. At the stage's top left a small pill (the strip's colours, 14px 600, fully round, no shadow) says what needs the owner, what he makes while he works, else a word about the page you are on ("I'm listening" on Chat), after a status dot: yellow while he needs the owner, green otherwise, the working dots while he works. It is a link to Today with a 2px focus ring, everywhere but on Today, where it is only words. His pose follows: pointing while anything needs the owner (at "Needs you", last on Today), researching or thinking while he works, friendly right after a report, else done. The drawing never takes a press (`pointer-events: none`) and steps down out of sight while a sheet or dialog is open. On a phone he stands in the Chat tab, on a 26px light disc. No page shows another picture of him (the chat's message avatars and the approval celebration are his voice, not the page's picture).
- **Avatar:** on a `#F5F5F5` circle with a line edge and a little padding, in both themes, so his black outline reads in dark. In the chat, beside his messages, the circle is Peach Blossom (`--peach`), the same in both themes. 36px in rows, 48px beside a title, 72 to 96px in a hero card, 176px where he leads an onboarding step.
- **Cuso leads onboarding.** Every step opens with his pose on the hero's Iris stage (`CusoScene`, 220 by 280px): Research, Brand, Plan, Subscribe and Launch each have their own; a failure or a question shows the Needs you avatar instead. While he works, a tilted label over the stage's lower edge says what he is doing now (with the working dot) and an ink bar runs along the bottom, so the wait reads as work. The title under him is what he says. Below him sits the one thing to do; everything else folds into rows (`.ob-fold`) and sheets, and the step's action stays in a bar at the bottom of the screen (`.ob-bar`).
- **Stage:** Cuso's stage is a picture, so it is flat: a 3px ink line and a 20px radius in onboarding, an Iris band with his spotlight in the sidebar. The hire hero adds up to three tilted labels (flat pills: 2px ink line, 16px 600); a step's scene carries one, what he is doing now. These are the only places labels tilt.
- **Celebration:** his check mark on an Iris card shows after Launch is pressed. Approving a post Cuso made swaps the card's buttons for a green row with his check mark on his light circle and when it goes out ("Approved. It goes out on X …"); he pops up with a small overshoot (520ms), the one bounce in the app, because the owner's yes is the moment it marks. Off under reduced motion.
- **Motion:** Cuso is a still everywhere but the sidebar. On the hire screen the three labels pop in one after another (500ms, transform only, the one entrance longer than 150ms); while he works, the bar under his pose or line runs. In the sidebar he moves the way the CMO.XYZ landing page's hero does (`cuso-rig.ts` drives `public/cuso/poses.svg`, one drawing with every pose, loaded once; the stage lives in the app's shell, so moving between pages never rebuilds him). His pose follows the moment: pointing while anything needs the owner, thinking while he works, researching on SEO and Competitors, walking for 1.2 seconds when the owner opens another page, done for 2.6 seconds when his work just finished, else the pose of his state. Opening a page, he steps off and walks in from the stage's left edge, his legs drawn live so his feet stay planted. Any other change is a squash and stretch: he sinks, the drawing changes at the bottom where the motion hides the cut, and he springs up. Done, he wobbles like a bobblehead; friendly, he waves on arrival and every seven seconds; researching, he sways with his glass; at rest he breathes. A pointer coming onto his stage makes him hop: he crouches, stretches as he takes off, rises on an arc leaning a little, squashes on landing and settles; the hop always finishes, and a pointer during it is ignored. Until his drawing loads he is the still of his pose. His stage is sized in percentages, never with a container query: Chrome re-evaluates a size query on every page change and restarts his motion. Under `prefers-reduced-motion` nothing moves: he keeps the pose of his state.
- **Name:** every string with the agent's name comes from the person's chosen name; build it in one string so no double space appears.

## Accessibility

- Text meets AA (Neutral 600 on white 7.8:1; Neutral 400 on Neutral 950 7.7:1; Neutral 950 on dark Iris 5:1).
- Focus: 2px solid `--foreground` outline, 2px offset. Iris is too light for a focus ring. A source chip inside a sentence draws it 4px inside its 32px tap area, so the ring hugs the words and not the lines around them.
- Tap targets 44px; dense rows may use 32px with 8px between.
- Status is never colour alone: each disc carries its glyph and an accessible name.
- Every image has `alt`; decorative Cuso avatars use `alt=""`.

## Deliberate deviations from the Masumi guide

- Thick ink lines and hard offset shadows (the guide asks for flat surfaces).
- Dark Iris at `#D141D1`.

Raise these with the guide owner rather than drifting further.

Last updated: 2026-11-23 (Cuso: brand guide 2D SVGs, the landing's motion, a spotlight)
