---
version: alpha
name: Sokosumi
description: >-
  A marketplace where marketing teams hire AI coworkers and AI agents that return finished files. Built by Serviceplan
  Group.
logo:
  src: https://sokosumi.com/assets/sokosumi-wordmark.svg?v=410c5571
colors:
  surface: '#f5f5f5'
  surface-dim: '#e9e8e6'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fafaf9'
  surface-container: '#f5f5f5'
  surface-container-high: '#ebeae9'
  surface-container-highest: '#e9e8e6'
  on-surface: '#0f0e0d'
  inverse-surface: '#0f1c25'
  inverse-on-surface: '#ffffff'
  outline: '#6b6b6b'
  surface-tint: '#2b5c78'
  primary: '#2b5c78'
  on-primary: '#ffffff'
  on-primary-container: '#0f1c25'
  inverse-primary: '#8fb4cc'
  secondary: '#0f0e0d'
  on-secondary: '#ffffff'
  secondary-container: '#ebeae9'
  on-secondary-container: '#0f0e0d'
  tertiary: '#6400ff'
  on-tertiary: '#ffffff'
  tertiary-container: '#ece6fb'
  on-tertiary-container: '#2c4452'
  error: '#b3261e'
  on-error: '#ffffff'
  error-container: '#f9dedc'
  on-error-container: '#410e0b'
  primary-fixed: '#8fb4cc'
  primary-fixed-dim: '#2b5c78'
  on-primary-fixed: '#0f1c25'
  on-primary-fixed-variant: '#2c4452'
  secondary-fixed: '#ebeae9'
  secondary-fixed-dim: '#d9dee2'
  on-secondary-fixed: '#0f0e0d'
  on-secondary-fixed-variant: '#6b6b6b'
  tertiary-fixed: '#ece6fb'
  tertiary-fixed-dim: '#6400ff'
  on-tertiary-fixed: '#0a0908'
  on-tertiary-fixed-variant: '#2c4452'
  background: '#f5f5f5'
  on-background: '#0f0e0d'
  surface-variant: '#ebeae9'
typography:
  display:
    fontFamily: Inter
    fontSize: 81.92px
    fontWeight: 300
    lineHeight: 86.016px
    letterSpacing: '-2.4576px'
  headline-lg:
    fontFamily: Inter
    fontSize: 54px
    fontWeight: '300'
    lineHeight: '1.08'
    letterSpacing: '-0.025em'
  headline-md:
    fontFamily: Inter
    fontSize: 44.8px
    fontWeight: 300
    lineHeight: 49.28px
    letterSpacing: '-1.12px'
  title-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: '-0.02em'
  body-lg:
    fontFamily: Inter
    fontSize: 16.5px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: normal
  label-md:
    fontFamily: Inter
    fontSize: 14.5px
    fontWeight: 500
    lineHeight: normal
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16.8px
rounded:
  sm: 2px
  DEFAULT: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  unit: 6px
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 14px
  gutter: 28px
  container-max: 1240px
elevation:
  sm: '0 0 0 2px #fff'
  md: 0 0 0 4px rgba(43, 92, 120, 0.08)
  lg: 0 12px 40px rgba(15, 14, 13, 0.14)
layout:
  containerMaxWidth: '1240'
components:
  button-primary:
    backgroundColor: '{colors.inverse-surface}'
    textColor: '{colors.inverse-on-surface}'
    typography: '{typography.label-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
    height: 40px
  button-primary-hover:
    backgroundColor: '#2c4452'
    textColor: '{colors.inverse-on-surface}'
  button-secondary:
    backgroundColor: transparent
    textColor: '{colors.on-surface}'
    typography: '{typography.label-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
    height: 40px
  button-secondary-hover:
    backgroundColor: transparent
    textColor: '{colors.on-surface}'
  button-accent:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
    height: 48px
  button-accent-hover:
    backgroundColor: '{colors.primary-fixed-dim}'
    textColor: '{colors.on-primary}'
  card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '{spacing.xl}'
  card-hover:
    backgroundColor: '{colors.surface-container-high}'
    rounded: '{rounded.lg}'
  input-field:
    backgroundColor: '{colors.surface-container-lowest}'
    textColor: '{colors.on-surface}'
    typography: '{typography.body-md}'
    rounded: '{rounded.DEFAULT}'
    padding: '{spacing.lg}'
  list-item:
    backgroundColor: transparent
    rounded: '{rounded.DEFAULT}'
    padding: '{spacing.sm}'
  list-item-hover:
    backgroundColor: '{colors.surface-container-high}'
    textColor: '{colors.primary}'
  badge:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.primary}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: '{spacing.xs}'
  cookie-banner:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '{spacing.xl}'
    typography: '{typography.body-md}'
---

## Overview

Sokosumi is a marketplace where marketing teams hire AI coworkers and agents and receive finished work as files: reports, documents, decks and dashboards. The aesthetic is Architectural Minimalism on a warm paper ground: a near-white #f5f5f5 canvas, ink #0f0e0d type, and hairline rules rather than decorative chrome. The hero fades a photographic scene into a cool slate gradient, so the page feels calm and editorial rather than promotional.

The voice is plain, professional and colleague-like. Coworkers are introduced by name and role, briefs are described as plain language, and the product is framed as work that "arrives as a file." Example sentence: "You write one briefing. They do the rest."

## Colors

Primary (#2b5c78) is the brand accent, used for interactive emphasis, focus and links on light surfaces; on dark bands it shifts to #8fb4cc so it keeps contrast on ink. The primary CTA is not the accent but the ink button (#0f1c25 fill, #ffffff label), which carries the Sign Up action in the hero. Tertiary #6400ff appears only in product-preview UI and small status highlights. Secondary is ink #0f0e0d, used for text and rules.

The surface stack is flat: page #f5f5f5, cards #ffffff, hover and muted fills #ebeae9. Text sits at #0f0e0d for headings and rgba(15,14,13,0.6) for secondary copy, which keeps body text above 4.5:1 on all light surfaces. Borders are rgba(15,14,13,0.12), never a solid grey.

## Typography

A single family, Inter, carries the whole system; hierarchy comes from size and a light 300 weight on display and headline levels rather than from a second typeface. Display headings at 81.92px with -0.03em tracking and 300 weight give the hero its airy, confident tone. Body copy is 15px at weight 400 and labels are 14.5px at weight 500. Apply letter-spacing: -0.025em to any heading above 32px; keep body and label text at normal tracking.

## Layout

The grid is fluid up to a fixed 1240px container with clamp(24px, 4vw, 56px) side padding, and content blocks use a 12-column rhythm with a 28px gutter. Sections are separated by a 1px rgba(15,14,13,0.12) top border and clamp(36px, 5vw, 56px) of vertical padding, so rhythm comes from rules and whitespace rather than colour bands. Use the xl (14px) spacing step inside cards and lg (12px) between stacked list items.

## Elevation & Depth

Depth is nearly absent in the resting state. The only shadow is the cookie and floating banner at 0 12px 40px rgba(15,14,13,0.14) on a 1px rgba(15,14,13,0.12) border. Focus and selected states use a 4px ring of rgba(43,92,120,0.08) and a 2px white inner ring. Layer order is conveyed by border and fill: Level 1 page #f5f5f5, Level 2 card #ffffff with a hairline border, Level 3 floating surfaces with the 40px shadow.

## Shapes

The shape language is Soft-Technical: small, deliberate radii, not pills. Buttons and inputs use 6px (md), cards use 8px to 12px (lg), and chips and tags use 2px to 4px. Only avatars and status badges are fully round (9999px). The 6px button radius matches the 14.5px label to feel precise rather than friendly.

## Components

### Action Elements

The primary button is ink (#0f1c25) at 40px height with 18px horizontal padding, 14px label weight 500, and a 6px radius. On hover it moves to #2c4452 over 250ms cubic-bezier(0.16, 1, 0.3, 1). The accent button uses the brand primary #2b5c78 at 48px height for key conversion points. Secondary buttons are transparent with a 1px rgba(15,14,13,0.12) border that darkens to rgba(15,14,13,0.4) on hover. Active state applies translateY(1px).

### Containers & Surfaces

Cards are #ffffff with an 8px radius and a 1px hairline border; on hover the fill moves to #ebeae9 over 250ms. Vendor and coworker cards place an avatar of 56px with 6px radius beside the name and role, with the chip row pinned to the bottom.

### Inputs & Interaction

Inputs sit on #ffffff with a 4px radius, 12px

## Do's and Don'ts

**Do**

- Do use the ink button (#0f1c25) as the primary call to action and reserve #2b5c78 for links and focus states.
- Do set display headings at weight 300 with -0.025em to -0.03em tracking so the hero stays light.
- Do separate sections with a 1px rgba(15,14,13,0.12) rule and 56px vertical padding rather than background colour bands.
- Do keep body copy at rgba(15,14,13,0.6) or darker to hold WCAG AA contrast on #f5f5f5.

**Don't**

- Don't use the #6400ff tertiary violet outside product previews; it competes with the brand accent.
- Don't round buttons into pills; the 6px radius is part of the precise tone.
- Don't add drop shadows to resting cards; hairline borders carry the structure.
- Don't set body text below 15px or use weights above 500 for running copy.
