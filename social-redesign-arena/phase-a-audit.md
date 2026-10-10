# Social Scheduling Section - UX Audit

**Date**: October 10, 2026  
**Branch**: `cursor/social-performance-ux-redesign-2e2c`  
**Scope**: All Social Scheduling features except Performance tab

## 1. Route Structure

### Primary Route
- `/social` - Main social scheduling page
  - With `?projectId=` - Scoped to specific project
  - Without `projectId` - All-projects view
  - With `?postId=` - Opens post preview dialog

### Related Components (in `/projects/components`)
- `project-social-accounts.tsx` - Connection management
- `social-posts/` - Post management components (27 files)

## 2. Component Mapping

### Core Components
1. **SocialPageShell** (`social/components/social-page-shell.tsx`)
   - Layout wrapper for the entire section

2. **SocialAllProjectsTabs** (`social/components/social-all-projects-tabs.tsx`)
   - Tab navigation for all-projects view
   - Shows calendar + actions

3. **ProjectSocialPosts** (`projects/components/social-posts/project-social-posts.tsx`)
   - Main posts management component
   - Tabs: Calendar, Queue, Published, Failed, Drafts, Accounts
   - Post list/grid with actions

4. **ProjectSocialAccounts** (`projects/components/project-social-accounts.tsx`)
   - Social account connection management
   - Providers: Twitter/X, LinkedIn, Instagram, Facebook
   - Connect/disconnect/reconnect flows via Composio OAuth

5. **SocialPostComposerDialog** (`social-posts/social-post-composer-dialog.tsx`)
   - Create/edit post dialog
   - Text editor, platform picker, media upload, scheduling
   - 1000+ lines - complex component

6. **WorkspaceCalendar** (from `/calendar`)
   - Reused calendar component
   - Month/week views
   - Social posts rendering

### Supporting Components
- **SocialPostPreviewDialog** - View post details
- **SocialPostSchedulePicker** - Date/time selection
- **SocialPostStatusBadge** - Status indicators
- **SocialPostMetrics** - Performance metrics
- **SocialPostPreview** - Platform-specific preview
- **SocialNewPostMenu** - New post button + menu

## 3. User Flows

### Flow 1: Connect a Social Account
**Steps:**
1. Navigate to `/social?projectId=<id>`
2. Click "Accounts" tab
3. Click "Connect" or "+" button
4. Choose provider (Twitter, LinkedIn, Instagram, Facebook)
5. OAuth popup opens
6. Authorize in provider
7. Popup closes, connection appears in list

**Current Issues:**
- OAuth popup flow can fail silently
- No clear feedback during connection
- "Pending" status not well explained
- Disconnect requires confirmation but doesn't explain consequences

### Flow 2: Create and Schedule a Post
**Steps:**
1. Click "New post" button
2. Composer dialog opens
3. Write post text
4. Select platform(s) from connected accounts
5. (Optional) Add media via Drive picker
6. Choose schedule: Now, Schedule, or Draft
7. If scheduling: pick date/time
8. Click "Publish" or "Schedule"

**Current Issues:**
- Composer is dense - 1000+ lines in one component
- Platform-specific rules not immediately clear
- Media validation happens after selection
- Schedule picker could be clearer
- No clear "save draft" vs "schedule" distinction
- Character limits not prominently shown
- No way to see how post will look on each platform before scheduling

### Flow 3: View Posting Schedule (Calendar)
**Steps:**
1. Navigate to `/social?projectId=<id>` 
2. Calendar tab is default view
3. See posts on calendar grid
4. Click post to view details

**Current Issues:**
- Calendar reuses workspace calendar - designed for tasks primarily
- Social posts are secondary citizens
- No agenda/list view option
- Hard to see posting frequency patterns
- No visual distinction between platforms

### Flow 4: Manage Drafts/Published/Failed Posts
**Steps:**
1. Navigate to relevant tab (Drafts, Published, Failed, Queue)
2. See list of posts
3. Click post for options: View, Edit, Retry, Cancel, Delete

**Current Issues:**
- Tabs feel like an afterthought
- No bulk actions
- "Queue" tab unclear - is it scheduled future posts?
- Failed posts don't explain why they failed
- No way to duplicate a post
- Published posts can't be edited (correct) but unclear why

## 4. Data Flow

### State Management
- **SocialComposeProvider** - Context for compose actions
- **SocialCalendarPreviewProvider** - Context for calendar preview
- URL state via `nuqs` for `projectId`, `postId`
- Tab state via Radix Tabs component

### Actions (Server Actions)
From `/lib/actions/project/action.ts`:
- `createProjectSocialPost`
- `updateProjectSocialPost`
- `scheduleProjectSocialPost`
- `publishProjectSocialPost`
- `cancelProjectSocialPost`
- `initiateProjectSocialConnection`
- `finalizeProjectSocialConnection`
- `disconnectProjectSocialConnection`

### Data Fetching
- `projectService.listSocialPosts(projectId, { statuses })`
- `projectService.getSocialPost(projectId, postId)`
- `projectService.listSocialConnections(projectId)`
- `loadWorkspaceCalendarPage()` - reused from calendar

## 5. Top UX Problems (Ranked by Impact)

### 🔴 Critical (User can't complete core task)

1. **Composer Complexity Overload**
   - **Evidence**: 1000+ line component, multiple concerns mixed
   - **Impact**: Users struggle to create posts, high cognitive load
   - **User Jobs Blocked**: Create post, Edit post
   - **File**: `social-post-composer-dialog.tsx`

2. **Connection Flow Opacity**
   - **Evidence**: OAuth failures silent, pending states unclear
   - **Impact**: Users can't trust if connection worked
   - **User Jobs Blocked**: Connect account
   - **File**: `project-social-accounts.tsx`

3. **Schedule vs. Draft Confusion**
   - **Evidence**: Two separate buttons, unclear difference
   - **Impact**: Users unsure how to save work-in-progress
   - **User Jobs Blocked**: Schedule post for later
   - **File**: `social-post-composer-dialog.tsx`

### 🟡 High (Significant friction in core flows)

4. **Calendar Forced Fit**
   - **Evidence**: Workspace calendar designed for tasks, social posts are guests
   - **Impact**: Hard to understand posting schedule at a glance
   - **User Jobs Affected**: See what's going out when
   - **Files**: `page.tsx`, workspace calendar integration

5. **Platform Preview Gap**
   - **Evidence**: No live preview of how post looks on each platform
   - **Impact**: Users can't see final result before publishing
   - **User Jobs Affected**: Write post
   - **File**: `social-post-composer-dialog.tsx`

6. **Tab Hierarchy Unclear**
   - **Evidence**: 6 tabs (Calendar, Queue, Published, Failed, Drafts, Accounts) with overlapping concepts
   - **Impact**: Users don't know where to find their posts
   - **User Jobs Affected**: Find posts, Manage schedule
   - **File**: `project-social-posts.tsx`, `constants.ts`

7. **No Bulk Operations**
   - **Evidence**: Only individual post actions available
   - **Impact**: Can't reschedule multiple posts, cancel batch
   - **User Jobs Affected**: Adjust schedule
   - **File**: `project-social-posts.tsx`

### 🟢 Medium (Polish and refinement)

8. **Failed Post Mystery**
   - **Evidence**: Posts fail but reason not prominently shown
   - **Impact**: Users don't know how to fix and retry
   - **User Jobs Affected**: Fix failed post
   - **File**: `project-social-posts.tsx`

9. **Mobile Experience Secondary**
   - **Evidence**: Composer is desktop-first, mobile gets squeezed
   - **Impact**: Hard to compose on mobile
   - **User Jobs Affected**: All on mobile
   - **File**: All components

10. **Empty States Generic**
    - **Evidence**: Standard "No posts" messages
    - **Impact**: Missed opportunity to guide next action
    - **User Jobs Affected**: Getting started
    - **File**: Various

## 6. Rubric for Redesign

Each candidate will be scored 1-5 on these criteria:

### 1. **Task Clarity and Hierarchy** (Weight: 2x)
- Is it obvious how to connect accounts, create posts, and view schedule?
- Are primary actions visually prominent?
- Is the information architecture intuitive?

### 2. **Fewest Steps for Core Jobs** (Weight: 2x)
- Connect account: Target ≤ 3 clicks
- Create and schedule post: Target ≤ 5 clicks
- View schedule: Target ≤ 2 clicks
- Retry failed post: Target ≤ 2 clicks

### 3. **Honest States** (Weight: 1.5x)
- Are loading, empty, error states thoughtfully designed?
- Do failed posts explain why and how to fix?
- Is connection status clear?
- Is post status (draft/scheduled/published/failed) always visible?

### 4. **Design System Consistency** (Weight: 1.5x)
- Uses Sokosumi semantic tokens from `globals.css`
- Follows spacing and typography scale
- Consistent with Performance tab (when implemented)
- Radix UI + Shadcn patterns

### 5. **Accessibility** (Weight: 1x)
- Keyboard navigation works
- Screen reader friendly
- Focus management in dialogs
- Color contrast meets WCAG 2.1 AA

### 6. **Mobile Experience** (Weight: 1x)
- Works well on 375px viewport
- Touch targets ≥ 44px
- Responsive layouts, not just squeezed desktop
- Critical features available on mobile

**Total possible score**: 50 points (10 criteria × 5 max score, weighted)

## 7. Core User Jobs (to validate against)

1. **Connect a social account** - First-time setup
2. **Write and schedule a post for multiple platforms** - Primary creation flow
3. **See what's going out when** - Schedule visibility
4. **Fix a failed post** - Error recovery
5. **Find and edit a draft** - Work-in-progress management
6. **View published posts** - Historical view

## 8. Files In Scope

### Routes
- `apps/web/src/app/(app)/social/page.tsx`
- `apps/web/src/app/(app)/social/loading.tsx`

### Social Components
- `apps/web/src/app/(app)/social/components/` (7 files)

### Project Social Components
- `apps/web/src/app/(app)/projects/components/project-social-accounts.tsx`
- `apps/web/src/app/(app)/projects/components/social-posts/` (20 non-test files)

### Excluded (Performance tab - being worked on by another agent)
- `social-performance-*.tsx`
- `social-post-metrics.tsx`
- `social-post-statistics.tsx`
- `posting-*.tsx`

## 9. Technical Constraints

- Must use Core API client (no direct DB access from web)
- Must maintain i18n parity (en/de/es)
- Must use Shadcn/Radix UI components
- Must follow color token system
- Must keep existing data contracts
- Can refactor components but preserve server actions
- OAuth flow via Composio must stay intact
- Calendar integration can be improved but not rewritten

## Next Steps

1. Capture screenshots of current state (all routes, states)
2. Spawn two parallel candidates with distinct approaches
3. Judge candidates against rubric
4. Pick winner and graft best ideas
5. Implement and verify
