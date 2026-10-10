# Social Scheduling Redesign - Cross-Judgment and Synthesis

**Judge**: Claude Opus 5-5 Max (opposite family from Candidate B)  
**Date**: October 10, 2026

## Scoring Rubric (from Phase A Audit)

Each criterion scored 1-5, weighted as noted:

1. **Task Clarity and Hierarchy** (Weight: 2x) - 10 points max
2. **Fewest Steps for Core Jobs** (Weight: 2x) - 10 points max
3. **Honest States** (Weight: 1.5x) - 7.5 points max
4. **Design System Consistency** (Weight: 1.5x) - 7.5 points max
5. **Accessibility** (Weight: 1x) - 5 points max
6. **Mobile Experience** (Weight: 1x) - 5 points max

**Total possible**: 45 points

---

## Candidate A: Three-Panel Unified Layout

### Scores

#### 1. Task Clarity and Hierarchy (Weight: 2x)
**Score: 4/5 = 8/10 points**

**Strengths:**
- Three-panel layout makes all key surfaces visible simultaneously
- Schedule view dropdown simplifies the 6-tab chaos
- Post creation always visible (not modal)
- Clear spatial organization

**Weaknesses:**
- On first load, unclear what to do ("Where do I start?")
- Three panels may feel overwhelming to new users
- "Schedule View" dropdown requires exploring to understand options

#### 2. Fewest Steps for Core Jobs (Weight: 2x)
**Score: 4/5 = 8/10 points**

**Connect account:** 3 clicks (Accounts → Connect → Provider) ✓ Meets target
**Create and schedule post:** 
- Write text (always visible)
- Next → Choose platforms
- Next → Schedule
- Schedule button
= 4 clicks ✓ Meets target (≤5)

**View schedule:** Calendar panel always visible = 0 clicks ✓✓

**Retry failed post:** 
- Filter to "Needs Attention" view
- Click post
- Click "Reconnect" or "Edit"
= 3 clicks (target ≤2) ✗ Misses by 1

**Strengths:**
- Calendar always visible eliminates navigation
- Progressive composer steps guide users
- Platform previews update live

**Weaknesses:**
- Filtering to "Needs Attention" adds a step
- Opening composer requires finding the panel (spatial learning curve)

#### 3. Honest States (Weight: 1.5x)
**Score: 5/5 = 7.5/7.5 points**

**Strengths:**
- Clear loading states documented
- Empty states guide next action
- Failed posts explain why + how to fix
- Connection status always visible
- Step progress in composer shows where you are

**Excellent execution.** No weaknesses identified.

#### 4. Design System Consistency (Weight: 1.5x)
**Score: 5/5 = 7.5/7.5 points**

**Strengths:**
- Explicitly follows Sokosumi tokens
- Uses Shadcn/Radix patterns
- Maintains spacing and typography scale
- Three-panel layout consistent with other pro tools

**Excellent execution.** Design system compliance is explicit and thorough.

#### 5. Accessibility (Weight: 1x)
**Score: 4/5 = 4/5 points**

**Strengths:**
- Keyboard navigation documented (Tab, Arrow, Enter, Esc)
- Screen reader labels specified
- Focus management planned
- ARIA live regions for status updates

**Weaknesses:**
- Three simultaneous panels may confuse screen reader users (which panel is "main"?)
- No mention of skip links between panels

#### 6. Mobile Experience (Weight: 1x)
**Score: 3/5 = 3/5 points**

**Strengths:**
- Documented mobile adaptations
- Single column with tabs
- Floating button for calendar
- Full-screen sheet for composer

**Weaknesses:**
- Mobile feels like an afterthought ("adapts" from desktop)
- Three panels → tabs means losing the core value prop on mobile
- Swipeable carousel mentioned but not detailed
- Touch targets mentioned but not shown in designs

---

**Candidate A Total: 38/45 points (84.4%)**

---

## Candidate B: Task-Centric Entry

### Scores

#### 1. Task Clarity and Hierarchy (Weight: 2x)
**Score: 5/5 = 10/10 points**

**Strengths:**
- Task cards immediately answer "What can I do?"
- Failed posts surfaced with badge count (high visibility)
- Recent activity provides context
- "I need help" mode for uncertain users
- No hunting, no tabs, no ambiguity

**Perfect execution.** This is exactly how you solve the "where do I start" problem.

#### 2. Fewest Steps for Core Jobs (Weight: 2x)
**Score: 5/5 = 10/10 points**

**Connect account:** 
- [@] icon → Add Account → Provider = 3 clicks ✓

**Create and schedule post:**
- "Create New Post" card
- Write text (defaults selected)
- Post button
= 3 clicks ✓✓ (beats target of 5)

**View schedule:**
- "View Schedule" card = 1 click ✓

**Retry failed post:**
- "Fix (3)" card → Auto-wizard = 1-2 clicks ✓✓

**Strengths:**
- Intelligent defaults eliminate steps (all platforms, post now)
- Task cards are one-click entry points
- Recovery wizard auto-walks through failures
- Everything is 1-3 clicks

**Best-in-class efficiency.**

#### 3. Honest States (Weight: 1.5x)
**Score: 5/5 = 7.5/7.5 points**

**Strengths:**
- Failed post wizard shows why + previews post
- Empty states contextual ("All caught up!" vs "Welcome!")
- Time zone awareness shown
- Platform validation inline
- Connection status with "Last post" time (helps debug)

**Excellent execution.** Especially strong on contextual error recovery.

#### 4. Design System Consistency (Weight: 1.5x)
**Score: 4/5 = 6/7.5 points**

**Strengths:**
- Task cards follow Shadcn patterns
- Uses semantic tokens
- Bottom sheet is standard mobile pattern

**Weaknesses:**
- Task hub layout is new (not used elsewhere in Sokosumi)
- Wizard pattern exists, but full-page wizard is novel
- Would need design system expansion to document these patterns

**Strong, but introduces new patterns that need documentation.**

#### 5. Accessibility (Weight: 1x)
**Score: 5/5 = 5/5 points**

**Strengths:**
- Keyboard navigation through task cards
- Wizard progress announced
- Connection status announced
- Task cards announce counts
- Clear focus management (wizard → next step)

**Best-in-class.** Task card pattern is naturally screen-reader friendly.

#### 6. Mobile Experience (Weight: 1x)
**Score: 5/5 = 5/5 points**

**Strengths:**
- Bottom sheet is mobile-first (not adapted)
- Thumb-friendly (actions at bottom)
- Partial sheet → expand is standard iOS/Android pattern
- Task cards naturally responsive
- Touch gestures documented

**Perfect mobile execution.** Designed for mobile from the start.

---

**Candidate B Total: 43.5/45 points (96.7%)**

---

## Criterion-by-Criterion Comparison

| Criterion | Candidate A | Candidate B | Winner |
|-----------|-------------|-------------|--------|
| Task Clarity | 8/10 | 10/10 | **B** |
| Fewest Steps | 8/10 | 10/10 | **B** |
| Honest States | 7.5/7.5 | 7.5/7.5 | Tie |
| Design Consistency | 7.5/7.5 | 6/7.5 | **A** |
| Accessibility | 4/5 | 5/5 | **B** |
| Mobile | 3/5 | 5/5 | **B** |
| **TOTAL** | **38/45** | **43.5/45** | **B** |

---

## Judge's Analysis

### Candidate A Strengths to Preserve
1. **Three-panel layout for power users** - Once learned, extremely efficient
2. **Live platform previews** - Critical feature missing from current system
3. **Progressive composer steps** - Clear progression through complex flow
4. **Schedule view dropdown** - Elegant solution to 6-tab problem

### Candidate A Weaknesses
1. **High cognitive load on entry** - Three panels + no clear starting point
2. **Desktop-first thinking** - Mobile feels adapted, not designed
3. **Spatial learning curve** - Users must learn panel locations

### Candidate B Strengths to Preserve
1. **Task cards as entry points** - Immediately answers "what can I do?"
2. **Intelligent defaults** - Reduces decisions, speeds up common case
3. **Failed post recovery wizard** - Walks users through fixes
4. **Mobile-first bottom sheet** - Native pattern, naturally responsive
5. **Drafts everywhere** - Surfaces drafts where users can act on them
6. **Connection panel always accessible** - [@] with badge for issues

### Candidate B Weaknesses
1. **New patterns require documentation** - Task hub, wizard, panels
2. **Task cards may feel "dumbed down"** to power users
3. **Calendar hidden behind "View Schedule"** - Not always visible

---

## Synthesis: Pick + Graft

### Base: Candidate B (Winner by Rubric)

**Adopt as the foundation:**
- Task hub homepage with task cards
- Intelligent defaults in composer
- Failed post recovery wizard
- Connection panel ([@] icon)
- Mobile bottom sheet
- Drafts integration everywhere

### Graft from Candidate A:
1. **Live platform previews** (Candidate A's killer feature)
   - Add preview panel to wizard's platform selection step
   - Show previews as user types (real-time updates)
   - Mobile: swipeable preview carousel

2. **Three-panel "Pro Mode" toggle** (for power users)
   - Add "Pro Mode" toggle in settings or as task card
   - Unlocks persistent three-panel layout
   - Default to task hub, but power users can opt in
   - Best of both worlds: simple for new users, efficient for experts

3. **Schedule view dropdown** (elegant tab replacement)
   - Add to calendar view (accessed via "View Schedule" card)
   - Dropdown filters: All / Scheduled / Drafts / Published / Needs Attention
   - Cleaner than separate tabs, more flexible than buttons

### Combined Flow

**New User:**
1. Lands on task hub
2. Clicks "Create New Post" card
3. Wizard with intelligent defaults
4. Real-time platform previews as they type
5. Posts with 3 clicks

**Power User:**
1. Enables Pro Mode (one-time)
2. Gets persistent three-panel layout
3. Calendar + composer + previews always visible
4. Retains task hub when closing panels

**Mobile User:**
1. Task cards (works great on mobile)
2. Bottom sheet composer
3. Swipeable preview carousel
4. Native patterns throughout

---

## Final Recommendation

**Implement Candidate B as base + graft Candidate A's:**
1. Live platform previews
2. Optional three-panel "Pro Mode"
3. Schedule view dropdown

**Why this synthesis wins:**
- Preserves B's 43.5/45 score (best task clarity, steps, mobile)
- Adds A's best feature (live previews)
- Offers power users an opt-in efficient mode
- Maintains mobile-first approach
- Solves tab chaos with dropdown (A's elegant solution)

**Estimated score of synthesis: 44.5/45 (98.9%)**

---

## Implementation Order

### Must-Have (Ship together)
1. Task hub homepage
2. Wizard composer with intelligent defaults
3. Platform previews (grafted from A)
4. Failed post recovery wizard
5. Connection panel
6. Mobile bottom sheet

### Can Ship Later
1. Three-panel Pro Mode (opt-in)
2. Drag-to-reschedule calendar
3. Bulk actions
4. Time zone optimization
5. Posting consistency tracker

### Rejected Ideas
1. Status tabs (both candidates eliminated this)
2. Modal composer (both candidates moved away from modals)
3. OAuth popup pattern (both improved on this)

---

## Next Steps

1. Create detailed component specs for synthesis
2. Design mockups (visual designer)
3. User testing with 5 users (task hub + wizard)
4. Implement Phase 1 (core flows)
5. Measure against success metrics:
   - Time to create first post < 2 minutes
   - Failed post recovery rate > 80%
   - Mobile completion rate > 60%
