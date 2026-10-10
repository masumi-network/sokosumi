# Social Performance UX Redesign Plan

## User Questions the Page Must Answer

Based on analyzing the current implementation and typical social media performance needs, users come to this page to answer:

### Primary (Above the fold, immediate scan)
1. **"How is this account doing right now?"**
   - Current performance snapshot: key metrics at a glance
   - Trend direction: getting better or worse?

2. **"What changed compared to last period?"**
   - Delta indicators that show growth/decline
   - Clear visual direction (up/down)

### Secondary (Progressive disclosure)
3. **"Which posts worked best?"**
   - Top performing content
   - Patterns in successful posts

4. **"When should I post?"**
   - Optimal posting times
   - Audience activity patterns

5. **"How do my accounts compare?"**
   - Cross-account performance
   - Format effectiveness

6. **"What should I do next?"**
   - Actions: export data, run analysis, sync latest
   - Research insights and recommendations

### Tertiary (Detailed exploration)
7. **"What's the data quality?"**
   - Coverage information
   - Missing metrics explanation
   - Sample size caveats

## Design Direction A: Hierarchical Scan Path

### Core Concept
Create a clear visual hierarchy that guides the eye from headline metrics → trend → insights → actions. Use size, weight, and progressive disclosure to prioritize information.

### Key Changes
1. **Hero Metrics Section** (no borders)
   - Large numbers with prominent delta arrows
   - Deltas integrated into the metric display, not buried
   - Remove statistical caveats from primary view
   - Clean, unboxed presentation

2. **Integrated Account Header**
   - Merge account switcher with account info
   - Remove redundant account identity repetitions
   - Single cohesive header bar

3. **Action Bar** (sticky/floating)
   - Sync and Export as secondary actions (icon buttons)
   - Don't compete with content
   - Available but not prominent

4. **Progressive Disclosure**
   - Trend chart starts visible
   - "More insights" collapsed by default
   - Heatmap, comparisons, growth in disclosure
   - Disclaimers/caveats contextual, not upfront

5. **Visual Hierarchy**
   - Metrics: largest, boldest
   - Trend: medium prominence
   - Insights: discoverable but not immediate
   - Caveats: inline with relevant sections

### Layout Structure
```
┌─────────────────────────────────────┐
│ Account Header (with tabs inline)  │
│ [Sync] [Export] (subtle, right)    │
├─────────────────────────────────────┤
│ HERO METRICS (no borders)          │
│ ┌───────┐ ┌───────┐ ┌───────┐      │
│ │  2.3K │ │  450  │ │  170  │      │
│ │  ↗ +42│ │  ↗ +8 │ │  ↘ -3 │      │
│ │ Views │ │Impress│ │Interact│     │
│ └───────┘ └───────┘ └───────┘      │
├─────────────────────────────────────┤
│ TREND (always visible)             │
│ [Chart: last 30 days]              │
├─────────────────────────────────────┤
│ ▶ More insights                     │
│   (collapsed by default)            │
│   • Posting times heatmap           │
│   • Account/format comparison       │
│   • Growth trends                   │
└─────────────────────────────────────┘
```

## Design Direction B: Dashboard Grid

### Core Concept
Present everything as equally weighted cards in a masonry/grid layout. Users scan the full dashboard and pick what interests them.

### Key Changes
1. **Card Grid**
   - All sections are cards
   - Metrics, trend, insights all equal visual weight
   - Users compose their own reading order

2. **Compact Metric Cards**
   - Each metric in its own card
   - Delta visible but not prominent
   - Stats inline with the number

3. **Separate Insight Panels**
   - Heatmap as its own card
   - Comparisons as separate cards
   - All discoverable at once

4. **Floating Action Bar**
   - Sync/Export in a sticky bar
   - Always visible as user scrolls

### Layout Structure
```
┌─────────────────────────────────────┐
│ [Account Tabs]  [Sync] [Export]    │
├──────────┬──────────┬───────────────┤
│ Card:    │ Card:    │ Card:         │
│ Views    │ Impressns│ Interactions  │
│ 2.3K ↗+42│ 450 ↗+8  │ 170 ↘-3       │
│ mean 85  │ mean 15  │ mean 12       │
├──────────┴──────────┴───────────────┤
│ Card: Trend                         │
│ [Chart with metric selector]        │
├──────────┬──────────────────────────┤
│ Card:    │ Card:                    │
│ Heatmap  │ Comparisons              │
│          │                          │
├──────────┴──────────────────────────┤
│ Card: Growth                        │
└─────────────────────────────────────┘
```

## Evaluation Rubric

| Criterion | Weight | Direction A | Direction B |
|-----------|--------|-------------|-------------|
| **Clear hierarchy** | HIGH | ✓✓✓ Progressive, guided | ✗ Equal weight, no priority |
| **Scan path** | HIGH | ✓✓✓ Top to bottom, clear | ✗ User must choose |
| **Progressive disclosure** | MEDIUM | ✓✓✓ Advanced hidden | ✗ Everything visible |
| **Data honesty** | HIGH | ✓✓ Contextual caveats | ✗ Stats compete with data |
| **Action placement** | MEDIUM | ✓✓ Subtle, available | ~ Visible but floating |
| **Responsive** | HIGH | ✓✓ Single column works | ✗ Grid breaks on mobile |
| **Accessibility** | HIGH | ✓✓✓ Linear structure | ✗ Harder to navigate |
| **Light/dark themes** | MEDIUM | ✓✓✓ Semantic tokens | ✓✓✓ Same |
| **Missing data handling** | HIGH | ✓✓ Inline with context | ✗ Empty cards stand out |

## Decision: Direction A (Hierarchical Scan Path)

### Rationale
Direction A wins on the most important criteria:
1. **Clear hierarchy answers user questions in order**: "How am I doing" → "What's trending" → "Deep insights"
2. **Progressive disclosure reduces cognitive load**: Users aren't overwhelmed by all data at once
3. **Better mobile experience**: Single column with collapsible sections works down to 320px
4. **Handles sparse data gracefully**: Missing metrics don't leave empty cards; caveats are contextual
5. **Accessibility**: Linear structure with clear landmarks is easier to navigate with keyboard/screen readers

Direction B's equal-weight cards work for dashboards where users have different priorities, but Performance has a clear question hierarchy: immediate status → trend → deep analysis.

### Key Implementation Principles
1. **Metrics first**: Remove borders, increase prominence, integrate deltas
2. **One account header**: Merge redundant identity repetitions
3. **Actions don't compete**: Sync/Export available but not prominent
4. **Progressive disclosure**: Advanced insights start collapsed
5. **Contextual caveats**: Stats inline with what they describe, not upfront
6. **Honest about missing data**: "—" for unavailable, not "0"
7. **Responsive from 320px up**: Mobile-first, then enhance
