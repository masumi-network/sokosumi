---
# Copied from github.com/masumi-network/CMO.XYZ-Style-Guide@c197cf10 (DESIGN.md).
# That repo is the source; change it there and re-copy this file.
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

CMO.XYZ is the product name. Each user names their own agent inside the product (the demo used "June" as an example). Every screen needs to support whatever name the user picks. Never hardcode one agent name for everyone.

### Voice and tone

Rules for any copy: onboarding, messages inside the app, marketing site, ads, error states.

- **Reference data, not vibes.** Every claim the agent makes ties to actual data or prior context in view. Never invented confidence.
- **Missing info gets requested, not hedged.** If the agent lacks something, it asks for it, framed as getting "better aligned," never "I'm not sure" or "I think."
- **Confidence comes from doing the analysis, not sounding clever.** State the plain, obvious conclusion. No gimmicks, no performance, no forced cleverness.
- Light banter is fine. Not stiff and corporate, not crude.
- No long, rambling sentences. Minimal fluff.
- Minimal to no em dashes or hyphens.
- Banned words and phrases: none locked yet. Flag anything that reads as hype or invented confidence for review.

Example prompt responses, from the current live build:

> "Here's my proposed strategy for you. Built from your setup answers and your shop data. I'll use it to guide every post, ad and email. Take a look, then I'll get started."

> "On it. I'll draft that now and put anything that needs approval in your Approvals. You'll get a note when it's ready."

### Status

| Area | Status |
| --- | --- |
| Product and positioning | Locked |
| Voice and tone | Locked |
| Typeface | Locked |
| Colors, logo, graphic language, colorway, agent avatars | Open |
| Layout, elevation, shapes, components | Blocked, waiting on visual identity |

The Colors, Layout, Elevation & Depth, Shapes, and Components sections are intentionally omitted until those decisions exist. Do not invent brand colors or shapes. Do not treat any current build or demo colors or shapes as final. If a placeholder is needed to keep building, use a neutral system default and flag it clearly as temporary in code and comments.

Layout and application specs will cover the website, the app, and the print flier for Token2049 (Oct 6 to 8, 2026, hard deadline).

## Typography

The confirmed brand typeface is **PP Mori**. The tokens above set the typeface only.

Font sizes, weights, line heights, letter spacing, the web fallback stack, and the source and license terms are TBD. Flag to design before implementation.

## Do's and Don'ts

- Do tie every claim the agent makes to actual data or prior context. Don't state anything with confidence that has no data behind it.
- Do ask for missing information, framed as getting "better aligned." Don't hedge with "I'm not sure" or "I think."
- Do support whatever agent name the user picks on every screen. Don't hardcode one agent name for everyone.
- Do keep copy plain and short. Don't write long, rambling sentences or lean on em dashes and hyphens.
- Do use a neutral system default for placeholder colors, logo, and avatars, and flag it as temporary. Don't treat current demo colors or shapes as final.
- Don't build the newsletter for Token2049. It is roadmap.
