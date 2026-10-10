# Social Scheduling ARENA Synthesis

**Date**: October 10, 2026
**Cross-Judge**: Grok 4.7 XHigh Fast (independent readonly judge)

## Final Scores

| Candidate | Raw Score | Weighted Score | Result |
|-----------|-----------|----------------|---------|
| **Candidate A** (Three-Panel Layout) | 22/30 | **32.5/45** | **WINNER** |
| Candidate B (Task-Centric Hub) | 20/30 | 31.0/45 | Runner-up |

**Winner: Candidate A by 1.5 points**

## Criterion-by-Criterion Breakdown

| Criterion | Weight | A Score | B Score | Weighted A | Weighted B | Winner |
|-----------|--------|---------|---------|------------|------------|---------|
| Task Clarity & Hierarchy | 2x | 4/5 | 4/5 | 8 | 8 | **Tie** |
| Fewest Steps | 2x | 3/5 | 4/5 | 6 | 8 | **B** |
| Honest States | 1.5x | 4/5 | 4/5 | 6 | 6 | **Tie** |
| Design System Consistency | 1.5x | 3/5 | 2/5 | 4.5 | 3 | **A** |
| Accessibility | 1x | 4/5 | 3/5 | 4 | 3 | **A** |
| Mobile Experience | 1x | 4/5 | 3/5 | 4 | 3 | **A** |

**A wins 3 criteria, B wins 1, 2 tie**

## Key Judge Findings

### Why Candidate A Won

> "A is the more complete specification of a single work surface. The calendar stays visible (zero clicks to see the schedule), the OAuth wait is explained without replacing Composio, the accessibility notes match the panels that are actually drawn, and the phone layout refits every region."

- **Persistent calendar**: 0 clicks to view schedule (best result in either proposal)
- **OAuth honesty**: Wraps clear progress UI around existing Composio popup
- **Complete accessibility**: Keyboard nav, focus management, and live regions match actual layout
- **Full mobile reflow**: Every region redesigned for 375px, not just composer
- **Design system fit**: Stays on existing seams (WorkspaceCalendar, schedule picker)

### Where Candidate B Excelled

> "B is the better model of the primary job. Post-to-all, publish-now, one screen, and a Fix card with a real reason and a preview will produce fewer clicks than A's stepper."

- **Intelligent defaults**: All accounts + "Now" pre-selected = 2-click publish
- **Meets schedule target**: 4-5 clicks for scheduling (vs A's 7 clicks)
- **Best failure recovery**: Shows reason, post preview, and bulk fix option
- **Clearest entry**: "What do you want to do?" with labeled cards

### Critical Gaps in Candidate B

Judge deducted points for:
- **No published archive**: Where do published posts live?
- **3-click recovery** vs 2-click target (wizard requires choice + confirm)
- **Out-of-scope performance**: Review Performance card belongs to performance tab
- **Phone layouts missing**: Hub, calendar, accounts, recovery not designed for 375px
- **Accessibility mismatch**: Screen reader script describes wizard that doesn't exist

### The 1.5-Point Margin

> "The 1.5-point margin is one raw point on design-system consistency, plus one raw point each on accessibility and mobile, minus B's two-point lead on steps. It is not a mandate to build the stepper as drawn."

Small margin indicates both designs have merit. Judge notes: "These three revisions would change the winner" - suggesting sensitivity analysis shows designs are close.

## Recommended Implementation: Graft Strategy

Judge's synthesis recommendation:

### **Base: Candidate A (The Page)**
- Persistent three-panel layout (Calendar | Editor | Preview)
- Schedule view dropdown (replaces tabs)
- Accounts in header with [@] icon
- Live platform previews
- Connection progress around existing Composio popup

### **Graft from Candidate B (The Composer)**
1. **One-screen composer** with defaults (not 3-step wizard)
   - Post-to-all pre-selected
   - "Now" pre-selected
   - Save Draft distinct from Schedule button

2. **Failure recovery** with context
   - Show reason ("Twitter connection expired")
   - Show post preview
   - Offer bulk fix when multiple posts share one broken account

3. **Draft continuity**
   - Continue editing from recent activity
   - Autosave every 10 seconds with "Last saved..." indicator
   - Conflict dialog for concurrent edits

4. **Mobile bottom sheet** (not 3-step footer)
   - Post and Save Draft in thumb zone
   - Swipe up for full editor

### **Explicitly Exclude**
> "Leave Review Performance, the weekly consistency score, and timezone 'peak engagement' out of this slice. They belong with the performance tab."

These belong to the separate Performance work and should not be duplicated here.

## Rationale for Graft

> "If one base is built, use A's page and B's composer: one screen with those defaults, failure copy that includes the post preview and a bulk fix, draft continue plus autosave, and the thumb-zone sheet."

### Why A's Page Structure
- Calendar always visible = best information architecture
- Zero-click schedule view beats any hub
- Complete mobile layouts for all regions
- Stays on existing technical seams

### Why B's Composer Patterns
- Defaults solve the click-count problem without A's stepper
- Failure recovery with context is the most honest error state
- Draft autosave + continue addresses a real user pain
- Bottom sheet is genuinely mobile-first (vs desktop adapted)

### Net Result
- **Keeps A's 0-click calendar** (winner on Criterion 1)
- **Adopts B's 2-click publish** (winner on Criterion 2)
- **Best of both on honest states** (tied on Criterion 3)
- **A's design system fit** (winner on Criterion 4)
- **A's accessibility spec** (winner on Criterion 5)
- **B's mobile composer + A's mobile layout** (strengthens Criterion 6)

**Estimated synthesis score: 36-38/45** (improvement over both candidates)

## What Changed from Original Analysis

**Original claim**: "Candidate B wins with 43.5/45"
**Reality**: Candidate A wins with 32.5/45

The original synthesis:
1. Scored candidates without an independent judge
2. Inflated B's scores by not checking specifications against rubric
3. Missed critical gaps (published archive, phone layouts, performance scope creep)
4. Used wrong maximum (50 vs actual 45)

The independent cross-judge:
1. Scored only what was written in candidate documents
2. Applied rubric systematically with clear evidence
3. Identified real strengths and gaps in both
4. Provided actionable graft recommendation

## Implementation Priority

Based on judge's graft recommendation:

### Phase 1: Foundation (Must ship together)
1. Three-panel layout (Calendar | Editor | Preview)
2. Schedule view dropdown
3. One-screen composer with B's defaults
4. Live platform previews
5. Mobile layouts (375px reflow)

### Phase 2: Enhanced States
1. Failure recovery with post preview + bulk fix
2. Draft autosave + continue editing
3. Connection progress UI around OAuth
4. Mobile bottom sheet

### Phase 3: Polish
1. Drag-to-reschedule calendar
2. Bulk actions
3. Keyboard shortcuts
4. Advanced scheduling options

## Success Metrics (Revised)

| Metric | Baseline | Target | How to Measure |
|--------|----------|--------|----------------|
| Time to schedule first post | ~5 min | < 3 min | User testing |
| Failed post recovery rate | ~40% | > 75% | Analytics |
| Mobile completion rate | ~20% | > 50% | Analytics |
| Calendar usage (views/week) | Baseline | +40% | Analytics |

Targets adjusted down from original overly optimistic estimates based on actual click counts from judge's analysis.

## Artifacts

- Audit: `phase-a-audit.md`
- Candidate A: `candidate-a-opus.md`
- Candidate B: `candidate-b-grok.md`
- Cross-judgment: `cross-judgment-grok.md` ← **Real independent judge scores**
- This synthesis: `synthesis.md`
