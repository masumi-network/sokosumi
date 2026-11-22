---
# Started as a copy of github.com/masumi-network/CMO.XYZ-Style-Guide@c197cf10 (DESIGN.md).
# Since 2026-11-05 this file and design-system.md are the source; sync the style guide repo from here.
version: alpha
name: CMO.XYZ
description: "An AI agent that automates a business's marketing, end to end, in one system."
typography:
  h1:
    fontFamily: PP Mori
  body-md:
    fontFamily: PP Mori
---

## Overview

CMO.XYZ is an AI agent that automates a business's marketing, end to end, in one system. Not a chatbot you prompt. Not a stack of separate tools.

The brand feels plain, direct, and grounded in data. Confidence comes from doing the analysis, not from sounding clever. Light banter is fine. Never stiff and corporate, never crude.

This file is the source of truth for dev, design, and website execution. It is a living document, filled in as decisions lock. Do not build against anything marked open as final.

### Product

User registers, gives their domain, and the agent builds and runs the marketing strategy.

**In scope:**

- Manages social media
- Creates and posts content
- Runs ads (Google + Meta)
- Handles website SEO
- Generates images and graphics

**Out of scope, roadmap:**

- Newsletter (down the road, not launch scope, do not build for Token2049)

### Primary users

Solo founders, small businesses with no marketing and wanting to put it on autopilot, and builders.

### Agent naming

CMO.XYZ is the product name. The agent is always called Cuso. People cannot name or rename him.

### Voice and tone

Rules for any copy: onboarding, messages inside the app, marketing site, ads, error states.

- **Reference data, not vibes.** Every claim the agent makes ties to actual data or prior context in view. Never invented confidence.
- **Missing info gets requested, not hedged.** If the agent lacks something, it asks for it, framed as getting "better aligned," never "I'm not sure" or "I think."
- **Confidence comes from doing the analysis, not sounding clever.** State the plain, obvious conclusion. No gimmicks, no performance, no forced cleverness.
- Light banter is fine. Not stiff and corporate, not crude.
- No long, rambling sentences. Minimal fluff.
- Minimal to no em dashes or hyphens.
- The month of marketing the agent writes is the strategy, never the plan. A plan is a paid CMO plan.
- What Cuso makes is a post, or an ad, an article or an email when it is one. Never a piece.
- **Written for non-marketers.** The owner is a founder who is not a marketer and has two minutes. Every label, message and strategy line says what happens for their business in their words: the brand, the buyer and the concrete action ("Project leads open a free NMKR Studio account"), never the buyer's inner state ("Leads work out which steps they can hand off"). Before shipping copy, read it as that founder: do I get it on first read, is there a word I'd look up, does a number disagree with another screen, could it be half as long?
- **One number per fact.** The same count reads the same on every screen ("Up to 840 posts" and the plan that makes all of it both say 840).
- **Marketing words stay out.** The list with what to say instead is `CMO_PLAIN_WORDS` in `packages/utils/src/cmo-plain-words.ts` (impressions, engagement, CTR, conversion, leads, qualified, funnel, cadence, ICP, SERP, KPI, touchpoint, nurture, activation, attribution, retargeting, UGC, CTA…). Cuso's rules quote it from cmo-v15 on, and Core's strategy review refuses it in what the owner reads (`cmoPlainWordsProblems`). Where a term must stay, give it one plain line ("Content pillars: the few topics your posts keep coming back to"). Also flag anything that reads as hype or invented confidence.

Example prompt responses, from the current live build:

> "Here's my proposed strategy for you. Built from your setup answers and your shop data. I'll use it to guide every post, ad and email. Take a look, then I'll get started."

> "On it. I'll draft that now and put anything that needs approval in your Approvals. You'll get a note when it's ready."

### Status

| Area                                    | Status                       |
| --------------------------------------- | ---------------------------- |
| Product and positioning                 | Locked                       |
| Voice and tone                          | Locked                       |
| Typeface                                | Locked                       |
| Colors, graphic language, agent avatars | Locked, see design-system.md |
| Logo                                    | Locked, see design-system.md |
| Layout, elevation, shapes, components   | Locked, see design-system.md |

Colors, layout, elevation, shapes, components and how Cuso is used live in [`design-system.md`](design-system.md). This file keeps the product, voice and naming rules.

Layout and application specs will cover the website, the app, and the print flier for Token2049 (Oct 6 to 8, 2026, hard deadline).

## Typography

The brand typeface is **PP Mori** (Regular and SemiBold, the cuts the marketing site ships; Inter stood in from 2026-11-05 to 2026-11-15). Sizes, weights and tracking are the type scale in [`design-system.md`](design-system.md).

## Do's and Don'ts

- Do tie every claim the agent makes to actual data or prior context. Don't state anything with confidence that has no data behind it.
- Do ask for missing information, framed as getting "better aligned." Don't hedge with "I'm not sure" or "I think."
- Do call the agent Cuso on every screen. Don't offer a way to name him.
- Do keep copy plain and short. Don't write long, rambling sentences or lean on em dashes and hyphens.
- Do take every color, size, shape and shadow from [`design-system.md`](design-system.md) through the tokens in `src/app/globals.css`.
- Don't build the newsletter for Token2049. It is roadmap.
