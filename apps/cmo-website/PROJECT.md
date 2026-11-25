# CMO.XYZ — Project brief

Source of truth for what the product is and how to talk about it on the
site. Pair this with the CMO.XYZ Style Guide `DESIGN.md` (typography,
voice, scope rules). Where this brief and DESIGN.md disagree, see
"Open conflicts" at the bottom — do not silently pick one.

## What it is

CMO.XYZ is an AI CMO. The agent is named **Cuso**. He is the only
marketing hire a business needs. He manages:

- Social media accounts
- Google Ads
- Meta Ads
- Website SEO
- Newsletter

He learns your brand, builds a strategy, and continuously executes and
improves it. The output fits the brand and does not sound like AI slop.

Cuso is referred to as "he".

## The Brand Brain

When Cuso learns a business he analyzes the website, brand, products,
target audience, competitors, and existing marketing, and builds a
persistent **Brand Brain** that everything else draws from.

## User lifecycle

1. **Sign up.** User gives basic info: website URL and marketing goals.
2. **Cuso learns the business.** Analyzes site, brand, products, audience,
   competitors, existing marketing, and builds the Brand Brain.
3. **Cuso creates a 1-month strategy.** Presented visually: content
   calendar, social posts, ad previews, SEO content, newsletters. The user
   can discuss and change it with Cuso until happy.
4. **Subscribe.** The user subscribes to put Cuso to work.
5. **Daily loop.** Every day Cuso looks at the strategy, upcoming content,
   past performance, and what's happening in the business, then plans and
   executes the next actions across all connected channels.
6. **Weekly measure.** Each week he analyzes performance and suggests or
   automatically makes improvements.
7. **Repeat.** Plan -> execute -> measure -> improve, continuously.

At any point the user can talk to Cuso to change course: post something
spontaneously, change the strategy, or create a short-term announcement.
He handles spontaneous requests, remembers them, and adapts on the fly.

## Core loop (one line)

Learns the brand -> builds the strategy -> executes daily -> measures
weekly -> improves. Forever.

## Decisions (confirmed with the user, 2026-10-01)

1. **Naming.** **CMO.XYZ is the company/brand.** **Cuso is the agent's
   name.** Use "Cuso" for the agent in copy (he/him); keep CMO.XYZ as the
   brand in the logo and nav. This supersedes the DESIGN.md "never hardcode
   an agent name" rule, since Cuso is the brand's agent name, not a
   per-user instance name.
2. **The app is live (updated 2026-11-17).** The product is launched at
   https://app.cmo.xyz. The site's primary action is **sign up**: main CTAs
   ("Start free", "Meet your CMO") go to https://app.cmo.xyz/signup and
   "Log in" goes to https://app.cmo.xyz/login. The pre-launch waitlist
   (decided 2026-10-01) is retired and its form and API route are removed.
3. **Newsletter.** Per the brief, Cuso manages Newsletter as a capability.
   DESIGN.md's "roadmap only" note predates this brief; show Newsletter as
   a real capability on the site.
4. **Approval and prices on the site (2026-11-17).** The site follows the
   app: the user approves the strategy, not each post, and nothing goes
   out before that. The user can change, pause or undo any piece by
   telling Cuso. Prices shown are the app's Polar plans: Starter $200,
   Growth $500, Scale $1,000 a month; yearly costs ten months; no trial.
5. **Who it is for and what a plan buys (Patrick, 2026-11-17).** The
   customer is a small business owner with no marketing person, or a team
   of one to three, who wants to grow and has no budget for an agency or a
   full-time hire. The site describes plans by posting pace, as the app
   does: Starter one post a day on each network, Growth two, Scale up to
   three. On Scale a person on our team checks every post before it goes
   out. The app does not have that review step yet.
6. **Words match the app (Patrick, 2026-11-17).** Cuso's month of
   marketing is the **strategy**, never the "plan". "Plan" means only a
   paid tier (Starter, Growth, Scale). Other app words to use as they are:
   Brand Brain, Cuso (he), Subscribe, Launch, and the channel names (X,
   LinkedIn, Instagram, Facebook, Google Ads, Meta Ads, Newsletter).
   Voice: the pre-redesign site. One short line per idea, result first.
7. **Proof line (Patrick, 2026-11-17).** "30,000+ posts made by CMO.XYZ"
   is Patrick's own figure and includes data outside our database. Use it
   exactly as written, at most twice on the page.
8. **A stranger must understand it (Patrick, 2026-11-17).** Every primary
   button says "Try Cuso free". Product words never go on a button.
   "Strategy" stays inside the page, explained where it first appears
   ("Your strategy is every post and ad for the month"). The site does not
   use "credits", "launch" or "Brand Brain"; it says what they mean.
   Cuso is introduced in the line under the headline as "your AI CMO"
   for a small business. There is no label above the headline.
9. **Facts for the copy (Patrick, 2026-11-17).** A card is required at
   sign-up: never mention cards, and never say or imply "no card needed".
   The owner always sets the ad budget; Cuso never spends beyond it. Cuso
   uses the style and images from the business's own website and makes his
   own graphics on top. The team check on Scale is an extra of that plan;
   never word it so the other plans sound unchecked or worse.
10. **One line, shadow and radius scale, shared with the app (Patrick,
    2026-11-17).** Tokens in `styles.css` `:root`; never write a literal
    line width or shadow offset.

    | Token | Value | Use |
    |---|---|---|
    | `--line` | 3px ink | every outlined thing: cards, frames, pictures, buttons, section rules, focus ring |
    | `--line-small` | 2px ink | chips, tags, labels, checkboxes, avatar circles |
    | `--hairline` | 1px soft grey | row dividers inside a card |
    | `--shadow` | 4px 4px 0 ink, no blur | anything you can click: buttons, FAQ rows |
    | `--shadow-big` | 6px 6px 0 ink, no blur | only the hero button |
    | no shadow | line only | everything you cannot click: the navbar frame, example cards, posts, plan table, photo, final card, labels |

    Nothing has an offset above 6px. A button on a dark card keeps the 4px
    offset in paper or Iris (`--shade`). Radii follow the app: 8px marks
    (checkboxes), 12px controls (buttons, chips, images), 20px cards, 28px
    panels (the final card), fully round pills and tags.

11. **Company and logos (Patrick, 2026-11-17).** CMO.XYZ belongs to
    **Sumico, Inc.**, not utxo AG; name Sumico, Inc. wherever the page names
    its company. The logos are the approved files from the Masumi Family
    Brand Guide (`logos/cmo-xyz/`), copied unchanged into `assets/logo/`:
    the stacked-text lockup in the navbar, the primary lockup on the final
    card, the monogram as the icon. Decision 12 lists every placement. A lockup
    with the mascot is never narrower than 120px.

12. **Logos on the page (Patrick, 2026-11-20).** Only the approved set from
    `Masumi-Family-Brand-Guide/logos/cmo-xyz` (copied as is into
    `assets/logo/`), each on the background the brand guide lists for it,
    never recoloured, rotated, stretched or given a shadow, at least 120px
    wide, with clear space around it. Where each one is used:
    - Navbar: stacked wordmark (black on white, white on black in dark mode).
    - Hero: no logo. The "30,000+ posts made by CMO.XYZ" proof is a speech
      bubble beside Cuso.
    - Pricing card (black): knockout block, white version.
    - FAQ (Iris in both themes): framed panel, see-through version.
    - Final card (white in both themes): the primary, outlined mascot on top.
    - Footer (black): the Iris wordmark.
