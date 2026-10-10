# Social Scheduling Redesign - Candidate A (Claude Opus 5-5 Max)

**Philosophy**: Unified creation flow with progressive disclosure

## Analysis of Current Issues

The current Social Scheduling section suffers from three core problems:

1. **Composer Overload**: The `social-post-composer-dialog.tsx` is 1000+ lines handling creation, editing, scheduling, media, and platform-specific rules all in one component
2. **Tab Confusion**: Six tabs (Calendar, Queue, Published, Failed, Drafts, Accounts) with overlapping purposes - users don't know where to find things
3. **Connection Opacity**: OAuth flows through Composio lack clear feedback, leaving users uncertain if connections succeeded

## Redesign Direction

### 1. Unified Three-Panel Layout

Replace tabs with a persistent three-panel view:

```
┌─────────────────────────────────────────────────────────────┐
│  [Schedule View ▼]  [+ New Post]              [@] Accounts │
├──────────────────┬──────────────────┬─────────────────────┤
│                  │                  │                      │
│   Calendar       │   Post Details   │   Platform Preview  │
│   (Month/Week)   │   & Editor       │   (Live updates)    │
│                  │                  │                      │
│   • Posts shown  │   • Write text   │   • Twitter card    │
│   • Click to     │   • Add media    │   • LinkedIn card   │
│     open         │   • Pick time    │   • Instagram card  │
│   • Drag to      │   • Save draft   │                     │
│     reschedule   │                  │   (Shows how post   │
│                  │                  │    will look on     │
│                  │                  │    each platform)   │
└──────────────────┴──────────────────┴─────────────────────┘
```

**Key Changes:**
- **Left**: Calendar is always visible, not buried in a tab
- **Middle**: Post creation/editing in context, not a modal
- **Right**: Live platform previews replace post-publish surprises

### 2. Simplified Schedule View Dropdown

Replace 6 tabs with a single "Schedule View" dropdown:

```
┌───────────────────────┐
│ Schedule View ▼       │
├───────────────────────┤
│ ○ All Posts           │ ← Default: calendar + all statuses
│ ○ Drafts Only         │ ← Filters calendar to drafts
│ ○ Scheduled Only      │ ← Future posts only
│ ○ Published           │ ← Historical view
│ ○ Needs Attention     │ ← Failed + needs retry
└───────────────────────┘
```

**Why Better:**
- Clear mental model: "I'm looking at my schedule filtered by..."
- Eliminates "Queue" confusion (it's just "Scheduled")
- "Needs Attention" surfaces failures without a dedicated tab
- One source of truth (calendar) with different views

### 3. Progressive Composer with Steps

Break the 1000-line composer into clear steps:

**Step 1: Write**
```
┌─────────────────────────────────────────┐
│ What do you want to say?                │
├─────────────────────────────────────────┤
│ [Text editor with character counts]     │
│                                          │
│ Twitter: 45/280                          │
│ LinkedIn: 45/3000 ✓                     │
│                                          │
│ [📎 Add media]  [😊 Add emoji]          │
│                                          │
│ [Cancel]              [Next: Platforms →]│
└─────────────────────────────────────────┘
```

**Step 2: Choose Platforms**
```
┌─────────────────────────────────────────┐
│ Where should this go?                   │
├─────────────────────────────────────────┤
│ ☑ Twitter (@username)                   │
│   └─ Preview: [Twitter card shown]      │
│                                          │
│ ☑ LinkedIn (Company Page)               │
│   └─ Preview: [LinkedIn card shown]     │
│                                          │
│ ☐ Instagram (@username)                 │
│   ⚠️ Image required for Instagram       │
│                                          │
│ + Connect more accounts                 │
│                                          │
│ [← Back]              [Next: Schedule →]│
└─────────────────────────────────────────┘
```

**Step 3: Schedule**
```
┌─────────────────────────────────────────┐
│ When should this go out?                │
├─────────────────────────────────────────┤
│ ○ Publish now                           │
│ ○ Schedule for later                    │
│   [Date picker] [Time picker]           │
│   Timezone: EST (Change)                │
│                                          │
│ ○ Save as draft                         │
│   (You can schedule it later)           │
│                                          │
│ [← Back]    [Save Draft]    [Schedule] │
└─────────────────────────────────────────┘
```

**Why Better:**
- Each step focuses on one decision
- Platform previews appear when platforms are selected
- Clear distinction between "Schedule" and "Save Draft"
- Can jump back to any step
- Character limits shown per-platform in context

### 4. Connection Flow with Clear States

**Before (OAuth popup, unclear status)**

**After: Inline connection with progress**
```
┌───────────────────────────────────────────┐
│ Connect Twitter                            │
├───────────────────────────────────────────┤
│ ⏳ Opening Twitter authorization...        │
│                                            │
│ [●●●○○○○○○○] Step 1 of 3                   │
│                                            │
│ Waiting for you to authorize Sokosumi     │
│ in the popup window.                       │
│                                            │
│ [Cancel]                                  │
└───────────────────────────────────────────┘

// Then after OAuth completes:
┌───────────────────────────────────────────┐
│ ✓ Connected Twitter                        │
├───────────────────────────────────────────┤
│ @username                                  │
│                                            │
│ • Post to your timeline                    │
│ • Read engagement metrics                  │
│                                            │
│ [Disconnect]                              │
└───────────────────────────────────────────┘
```

**Why Better:**
- Progress indicator shows it's not stuck
- Explains what's happening at each stage
- Success state shows what permissions were granted
- Clear disconnect option

### 5. Failed Post Recovery

**Current:** Posts sit in "Failed" tab with no guidance

**After:** Prominent recovery UI
```
┌─────────────────────────────────────────────┐
│ ⚠️ This post couldn't be published          │
├─────────────────────────────────────────────┤
│ Reason: Twitter connection expired          │
│                                              │
│ To fix:                                      │
│ 1. Reconnect Twitter account                │
│ 2. Review your post                          │
│ 3. Try publishing again                      │
│                                              │
│ [Reconnect Twitter]  [Edit Post]  [Delete] │
└─────────────────────────────────────────────┘
```

### 6. Mobile-First Adaptations

**Desktop:** Three panels side-by-side
**Mobile (< 768px):** 
- Single column with tabs: Editor | Preview
- Calendar accessed via floating button
- Composer opens as full-screen sheet
- Platform previews swipeable carousel

## Component Restructure

### New Component Tree
```
SocialPage
├── SocialLayoutFrame (replaces SocialPageShell)
│   ├── ScheduleViewSelector (dropdown, replaces tabs)
│   ├── AccountsMenu (moved from tab to header)
│   └── NewPostButton
├── SocialThreePanelLayout
│   ├── CalendarPanel
│   │   └── WorkspaceCalendar (existing, enhanced)
│   ├── PostEditorPanel
│   │   ├── PostWriter (Step 1: text + media)
│   │   ├── PlatformSelector (Step 2: platforms)
│   │   ├── SchedulePicker (Step 3: timing)
│   │   └── PostEditorStepper (progress + navigation)
│   └── PlatformPreviewPanel
│       └── PlatformPreviewTabs
│           ├── TwitterPreview
│           ├── LinkedInPreview
│           ├── InstagramPreview
│           └── FacebookPreview
└── ConnectionFlow
    ├── ConnectionWizard (replaces OAuth popup pattern)
    ├── ConnectionStatusCard
    └── ConnectionRecoveryPrompt
```

### Files to Create/Modify

**New Components:**
- `apps/web/src/app/(app)/social/components/social-three-panel-layout.tsx`
- `apps/web/src/app/(app)/social/components/schedule-view-selector.tsx`
- `apps/web/src/app/(app)/social/components/post-editor-stepper.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/platform-preview-panel.tsx`
- `apps/web/src/app/(app)/projects/components/connection-wizard.tsx`
- `apps/web/src/app/(app)/projects/components/connection-recovery-prompt.tsx`

**Refactored Components:**
- Split `social-post-composer-dialog.tsx` into:
  - `post-writer.tsx` (text + media, ~200 lines)
  - `platform-selector.tsx` (platform picker + previews, ~150 lines)
  - `schedule-picker.tsx` (datetime, ~100 lines) - already exists, enhance
  - `post-editor-panel.tsx` (orchestrator, ~200 lines)

**Modified Components:**
- `social-page-shell.tsx` → `social-layout-frame.tsx` (new header pattern)
- `project-social-posts.tsx` → Remove tabs, use new panel layout
- `project-social-accounts.tsx` → Inline connection wizard
- `social-post-preview.tsx` → Extract platform-specific preview components

## State Management Updates

### Before
- SocialComposeProvider (global compose context)
- Tab state via Radix
- URL state for projectId, postId

### After
- SocialEditorProvider (current post being edited)
- SocialScheduleProvider (view filtering + calendar state)
- SocialConnectionProvider (connection status + recovery)
- URL state: `?projectId=`, `?view=`, `?editing=` (postId when editing)

## Empty States

### No Connected Accounts
```
┌─────────────────────────────────────────┐
│           📱                            │
│                                         │
│  Connect your first account             │
│  to start scheduling posts              │
│                                         │
│  [Connect Twitter]                      │
│  [Connect LinkedIn]                     │
│  [Connect Instagram]                    │
└─────────────────────────────────────────┘
```

### No Scheduled Posts
```
┌─────────────────────────────────────────┐
│  Your calendar is clear                 │
│                                         │
│  Click "New Post" to schedule something │
│                                         │
│  [+ New Post]                           │
└─────────────────────────────────────────┘
```

### Needs Attention (Failed Posts)
```
┌─────────────────────────────────────────┐
│  ⚠️ 3 posts need your attention         │
│                                         │
│  • Twitter post (expired connection)    │
│  • LinkedIn post (rate limit)           │
│  • Instagram post (media too large)     │
│                                         │
│  [Review Failed Posts]                  │
└─────────────────────────────────────────┘
```

## Accessibility Improvements

1. **Keyboard Navigation**
   - `Tab` through composer steps
   - `Arrow keys` navigate calendar
   - `Enter` to select date/platform
   - `Esc` closes panels (not entire composer)

2. **Screen Reader**
   - ARIA labels on all panels
   - Live regions announce post status changes
   - Platform preview cards announce character counts
   - Connection progress announced

3. **Focus Management**
   - Opening composer focuses text editor
   - Completing step focuses next step header
   - Closing composer returns focus to trigger button

## Implementation Priority

### Phase 1: Core Layout (Week 1)
- [ ] Three-panel layout component
- [ ] Schedule view selector
- [ ] Move accounts to header

### Phase 2: Composer Refactor (Week 2)
- [ ] Split composer into steps
- [ ] Post writer component
- [ ] Platform selector component  
- [ ] Schedule picker (enhance existing)

### Phase 3: Platform Previews (Week 3)
- [ ] Preview panel component
- [ ] Twitter preview
- [ ] LinkedIn preview
- [ ] Instagram preview
- [ ] Facebook preview

### Phase 4: Connection UX (Week 4)
- [ ] Connection wizard
- [ ] Connection status cards
- [ ] Failed post recovery UI

### Phase 5: Polish (Week 5)
- [ ] Mobile responsive layout
- [ ] Empty states
- [ ] Loading states
- [ ] Error boundaries
- [ ] Accessibility audit

## Risk Mitigation

1. **Breaking existing flows**: Keep old composer as fallback for 2 weeks
2. **Calendar performance**: Lazy load posts outside visible range
3. **Preview accuracy**: Platform preview mocks may not match 100%
4. **OAuth complexity**: Composio integration stays unchanged, only wrap UI

## Success Metrics

- Time to create first post: < 2 minutes (currently ~5 minutes with confusion)
- Failed post recovery rate: > 80% (currently ~40%)
- Mobile completion rate: > 60% (currently ~20%)
- User satisfaction (NPS): +20 points
