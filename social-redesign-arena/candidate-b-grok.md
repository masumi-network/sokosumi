# Social Scheduling Redesign - Candidate B (Grok 4.7 XHigh)

**Philosophy**: Task-oriented flows with intelligent defaults

## Core Insight

Current system models social posting like a database CRUD interface (tabs for each status). Users think in tasks: "I want to post something", "Did my post go out?", "Why did this fail?". Redesign around user tasks, not data states.

## Redesign Direction

### 1. Task-Centric Entry Points

Replace status tabs with task cards:

```
┌───────────────────────────────────────────────────┐
│  Social Scheduling                    [@] Accounts │
├───────────────────────────────────────────────────┤
│                                                    │
│  What do you want to do?                          │
│                                                    │
│  ┌────────────────┐  ┌────────────────┐          │
│  │  📝 Create     │  │  📅 View       │          │
│  │  New Post      │  │  Schedule      │          │
│  │                │  │                │          │
│  │  Write and     │  │  See what's    │          │
│  │  schedule a    │  │  coming up     │          │
│  │  new post      │  │                │          │
│  │                │  │  [Open]        │          │
│  │  [Start]       │  │                │          │
│  └────────────────┘  └────────────────┘          │
│                                                    │
│  ┌────────────────┐  ┌────────────────┐          │
│  │  ⚠️ Fix (3)    │  │  📊 Review     │          │
│  │  Failed Posts  │  │  Performance   │          │
│  │                │  │                │          │
│  │  3 posts need  │  │  See how your  │          │
│  │  attention     │  │  posts did     │          │
│  │                │  │                │          │
│  │  [Fix Now]     │  │  [View Stats]  │          │
│  └────────────────┘  └────────────────┘          │
│                                                    │
│  ─────────────────────────────────────────────── │
│                                                    │
│  Recent Activity                                  │
│  • Posted to Twitter 2 minutes ago               │
│  • Draft saved 15 minutes ago                    │
│  • LinkedIn post scheduled for 3:00 PM           │
│                                                    │
└───────────────────────────────────────────────────┘
```

**Why:**
- Immediate clarity: "What can I do here?"
- Failed posts surfaced prominently (badge count)
- Recent activity provides context
- No hunting through tabs

### 2. Wizard-Style Composer with Intelligent Defaults

**Key Innovation:** Pre-fill everything that can be inferred

```
┌─────────────────────────────────────────────────┐
│  Create New Post                                │
├─────────────────────────────────────────────────┤
│  [◉] I'm ready to go    [ ] I need help        │
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │ What's on your mind?                        ││
│  │                                              ││
│  │ [Text editor]                                ││
│  │                                              ││
│  │ 0/280 (Twitter) • 0/3000 (LinkedIn)         ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  📸 Add Media   [Browse] [From Project Drive]  │
│                                                  │
│  ─────────────────────────────────────────────  │
│                                                  │
│  Post to:  ☑️ All connected accounts (3)        │
│            [Customize platforms ▼]              │
│                                                  │
│  When:     ● Now   ○ Later  ○ Draft             │
│            [Schedule for later ▼]               │
│                                                  │
│  ─────────────────────────────────────────────  │
│                                                  │
│  [Save as Draft]            [Post / Schedule]   │
└─────────────────────────────────────────────────┘
```

**Intelligent Defaults:**
- "Post to all" selected by default
- "Now" selected by default
- Media picker shows recent project files first
- Character count updates real-time for all platforms
- Expandable sections hide complexity

**"I need help" mode:**
- Shows platform-specific tips
- Character limit warnings upfront
- Media size/format requirements
- Best time to post suggestions

### 3. Calendar View with Smart Grouping

```
┌─────────────────────────────────────────────────┐
│  October 2026                    [Week] [Month]  │
├─────────────────────────────────────────────────┤
│  Mon 10/7   Tue 10/8   Wed 10/9   Thu 10/10     │
│  ────────   ────────   ────────   ────────      │
│             9:00 AM    12:00 PM   ⚠️ 2:00 PM   │
│             📝 Post    📝 Post    ⚠️ Failed     │
│             3 platforms 2 platforms 1 platform   │
│                                                  │
│  Fri 10/11  Sat 10/12  Sun 10/13               │
│  ────────   ────────   ────────                │
│  10:00 AM   [empty]    [empty]                  │
│  📝 Post                                        │
│  2 platforms                                    │
│                                                  │
│  ─────────────────────────────────────────────  │
│                                                  │
│  ⚠️ 2 posts failed this week                    │
│  [Review failed posts]                          │
│                                                  │
│  📊 Posting consistency: 4 days this week        │
│  [View full stats]                              │
└─────────────────────────────────────────────────┘
```

**Smart Features:**
- Posts grouped by time slot (no clutter)
- Failed posts highlighted with clear badge
- Empty days shown (prompts consistent posting)
- Click time slot to see details or quick-edit
- Drag post to reschedule
- Weekly consistency score

### 4. Connection Management: Inline, Always Visible

```
┌─────────────────────────────────────────────────┐
│  Connected Accounts            [+ Add Account]   │
├─────────────────────────────────────────────────┤
│                                                  │
│  ✓ Twitter                                      │
│    @username  •  Connected  •  [Manage]          │
│                                                  │
│  ✓ LinkedIn                                     │
│    Company Page  •  Connected  •  [Manage]       │
│                                                  │
│  ⚠️ Instagram                                    │
│    Connection expired  •  [Reconnect Now]        │
│    Last post: 2 days ago                         │
│                                                  │
│  ○ Facebook                                     │
│    [Connect]                                     │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Always accessible** via `[@]` icon in header:
- Badge shows connection issues
- Click opens panel (not tab)
- Shows last post time (helps debug expired connections)
- "Reconnect Now" button prominent

### 5. Failed Post Recovery: Contextual Wizard

When clicking "Fix (3)" card or failed post:

```
┌─────────────────────────────────────────────────┐
│  Let's fix these posts                          │
├─────────────────────────────────────────────────┤
│  Post 1 of 3                                    │
│                                                  │
│  ❌ Couldn't post to Twitter                    │
│     Reason: Account connection expired          │
│                                                  │
│  Preview:                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ "Check out our new feature launch! 🚀"   │  │
│  │  [image]                                  │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  What do you want to do?                        │
│  ○ Reconnect Twitter and retry                  │
│  ○ Edit post and reschedule                     │
│  ○ Delete this post                             │
│                                                  │
│  [Skip]                     [Fix & Continue]    │
└─────────────────────────────────────────────────┘
```

**Wizard walks through each failure:**
- Shows what failed and why (no cryptic errors)
- Previews the post (reminds you what it was)
- Offers solutions, not just "retry"
- Can bulk-fix same issue (e.g., "Reconnect Twitter for all 3 posts")

### 6. Drafts: Integrated, Not Hidden

**Current:** Hidden in a tab users forget exists

**After:** Drafts shown everywhere relevant

**On homepage:**
```
Recent Activity
• Draft saved 15 minutes ago       [Continue editing]
• Posted to Twitter 2 hours ago
```

**In composer:**
```
┌─────────────────────────────────────────┐
│  You have 2 drafts in progress         │
│                                         │
│  • "Check out our new feature" (Oct 5)  │
│  • "Join us at the conference" (Oct 3)  │
│                                         │
│  [Load draft ▼] or [Start fresh]       │
└─────────────────────────────────────────┘
```

**On calendar:**
```
📝 Drafts (2)
   [Pin to calendar to schedule]
```

**Why:**
- Drafts surface where users can act on them
- "Continue editing" removes friction
- Pin metaphor clear: drag draft onto calendar to schedule

### 7. Mobile: Bottom Sheet Composer

Desktop: Full wizard in main area
Mobile: Bottom sheet that grows

```
─────────────────────────────
           [|||]
─────────────────────────────
📝 New Post

[Text editor]

☑️ Twitter  ☑️ LinkedIn

[Save Draft]        [Post]
─────────────────────────────
```

**Swipe up to expand:**
- Full editor
- Media picker
- Platform selector
- Schedule picker

**Why:**
- Thumb-friendly (buttons at bottom)
- Partial sheet shows key info
- Full expansion for detail work

## Component Restructure

### New Component Tree
```
SocialTaskHub (replaces SocialPageShell)
├── TaskCards
│   ├── CreatePostCard
│   ├── ViewScheduleCard
│   ├── FixFailedPostsCard (badge count)
│   └── ReviewPerformanceCard
├── RecentActivityFeed
│   └── ActivityItem (drafts, posts, failures)
└── QuickAccessPanel
    └── ConnectedAccountsIndicator

SocialWizardComposer (replaces modal)
├── ComposerModeToggle (Ready / Need Help)
├── PostTextEditor (character counts all platforms)
├── MediaPicker (project drive first)
├── SmartDefaults
│   ├── PlatformPresets (all / custom)
│   └── TimingPresets (now / later / draft)
└── ActionBar (Save Draft / Publish)

SocialSmartCalendar (existing calendar + enhancements)
├── CalendarGrid (existing WorkspaceCalendar)
├── PostSlotGroup (grouped posts per time slot)
├── FailedPostIndicators
├── DragToReschedule
└── ConsistencyTracker

ConnectionPanel (sidebar panel)
├── ConnectedAccountsList
├── ConnectionStatusBadges
└── InlineConnectionWizard

FailureRecoveryWizard
├── FailedPostCarousel (one at a time)
├── ErrorExplanation
├── PostPreview
├── RecoveryActions
└── BulkFixOption
```

### Files to Create/Modify

**New Components:**
- `apps/web/src/app/(app)/social/components/social-task-hub.tsx` (homepage)
- `apps/web/src/app/(app)/social/components/task-cards.tsx`
- `apps/web/src/app/(app)/social/components/recent-activity-feed.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/social-wizard-composer.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/connection-panel.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/failure-recovery-wizard.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/post-slot-group.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/drafts-integration.tsx`

**Refactored:**
- `social-post-composer-dialog.tsx` → `social-wizard-composer.tsx` (wizard pattern)
- `project-social-posts.tsx` → Remove tabs, embed calendar + wizard
- `project-social-accounts.tsx` → `connection-panel.tsx` (slide-out panel)

**Enhanced:**
- `social-calendar-preview.tsx` → Add post grouping, drag-to-reschedule
- `social-post-status-badge.tsx` → Add contextual recovery actions

## State Management

### New Providers
- `SocialTaskProvider` - Tracks user's current task (create/view/fix/review)
- `SocialDraftProvider` - Draft state + auto-save
- `SocialRecoveryProvider` - Failed post queue + bulk actions
- `SocialDefaultsProvider` - User's posting preferences (platforms, times)

### URL State
- `?task=create|schedule|fix|stats` - Active task
- `?postId=` - Editing specific post
- `?recovery=` - In recovery wizard

## Intelligent Features

### 1. Auto-Save Drafts (Every 10 Seconds)
- Silent save, no confirmation needed
- "Last saved 2 seconds ago" indicator
- Recover on page crash

### 2. Platform-Specific Validation
```
Instagram selected + no media:
┌─────────────────────────────────────────┐
│ 📸 Instagram requires an image or video │
│                                          │
│ [Add media]  or  [Uncheck Instagram]    │
└─────────────────────────────────────────┘
```

### 3. Time Zone Awareness
```
Schedule for:  [Oct 10 at 3:00 PM EST]

Recipients will see this:
• New York: 3:00 PM (peak engagement)
• London: 8:00 PM
• Tokyo: 4:00 AM (low engagement)

[Optimize for timezone]
```

### 4. Bulk Reschedule
```
Select multiple posts:
☑️ Oct 10, 9 AM - Post 1
☑️ Oct 10, 12 PM - Post 2
☑️ Oct 10, 3 PM - Post 3

[Move to next week] [Change time] [Delete]
```

## Empty States

### No Tasks to Do
```
┌──────────────────────────────────┐
│         ✨                       │
│                                   │
│  All caught up!                  │
│  No posts need attention.        │
│                                   │
│  [Create a new post]             │
│  [View your schedule]            │
└──────────────────────────────────┘
```

### First Post Ever
```
┌──────────────────────────────────┐
│         🎉                       │
│                                   │
│  Welcome to Social Scheduling!   │
│                                   │
│  Let's post your first message.  │
│  We'll walk you through it.      │
│                                   │
│  [Get started]                   │
└──────────────────────────────────┘
```

## Accessibility

1. **Keyboard Navigation**
   - Arrow keys navigate task cards
   - Tab through wizard steps
   - Calendar navigation via arrows + Enter
   - Escape closes panels (not wizard progress)

2. **Screen Reader**
   - Task cards announce counts ("Fix Failed Posts, 3 items")
   - Wizard announces step progress ("Step 2 of 3")
   - Calendar announces date + post count
   - Connection status announced ("Instagram, connection expired")

3. **Focus Management**
   - Opening wizard focuses text editor
   - Saving draft confirms + returns to trigger
   - Failed post fixed → focuses next post

## Implementation Priority

### Phase 1: Task Hub (Week 1)
- [ ] Task card layout
- [ ] Recent activity feed
- [ ] Navigation to existing flows

### Phase 2: Wizard Composer (Week 2)
- [ ] Wizard layout with defaults
- [ ] Auto-save drafts
- [ ] Platform validation
- [ ] Draft loading

### Phase 3: Smart Calendar (Week 3)
- [ ] Post slot grouping
- [ ] Drag to reschedule
- [ ] Failed post indicators
- [ ] Consistency tracker

### Phase 4: Recovery UX (Week 4)
- [ ] Failure recovery wizard
- [ ] Connection panel
- [ ] Bulk fix actions

### Phase 5: Mobile (Week 5)
- [ ] Bottom sheet composer
- [ ] Mobile calendar
- [ ] Touch gestures
- [ ] Responsive task cards

## Risk Mitigation

1. **User learning curve**: Onboarding tour highlights task cards
2. **Draft conflicts**: Show conflict resolution dialog
3. **Bulk actions**: Confirm before bulk delete/reschedule
4. **Time zones**: Default to user's local, allow override

## Success Metrics

- Task completion time: < 90 seconds (currently ~4 minutes)
- Draft→published rate: > 70% (currently ~30% drafts abandoned)
- Failed post resolution: < 5 minutes (currently ~15 minutes)
- Mobile NPS: +25 points
