# Sokosumi - story map report

_Generated from `stories.yaml` by storymap.py - edit the source, not this file._

web · main @ 57fb09e7e (apps/web, mobile width 390x844) · checked 2026-10-16

Marketplace where people give tasks to AI coworkers and follow the results (mobile web app, PWA; macOS app, no iOS app).

> Local demo data plus 10 read-only production screens; names, emails, avatars, organization, chats and private text are masked (G-10).

**48 stories:** 🟢 30 built · 🟠 5 partly · 🟣 12 unverified · ⚪ 1 missing
Built = checked in code/running app (see Verified); unverified = not checked yet.

**Open these first (browser-friendly):** [architecture preview](architecture-preview.png) (8000 px wide, 1.5 MB) · [one-pager preview](one-pager-preview.png) (7000 px wide, 2.3 MB) · [full-resolution tiles](tiles/README.md) (architecture 4x2, one-pager 2x2) · [story-map.html](story-map.html)

Download for full resolution (too large for most browsers and GitHub's viewer): [architecture.png](architecture.png) (29600x15200, 12 MB) · [one-pager.png](one-pager.png) (15279x18754, 9 MB)

## Topics

| Topic | Screens | Stories | Status counts | Flows |
|---|---|---|---|---|
| Onboarding | 2 | 2 | 🟣 2 | First-run workspace setup |
| Login & account access | 6 | 5 | 🟢 2 · 🟣 3 | Sign in and sign up |
| Main journey: tasks with AI coworkers | 30 | 23 | 🟢 14 · 🟠 4 · 🟣 5 | Home and navigation, Tasks, Projects, Chat and coworkers, Schedules, calendar and studio |
| Files & library | 2 | 1 | 🟢 1 | Files, tables and history |
| Settings & account | 11 | 11 | 🟢 10 · 🟠 1 | You menu and account settings |
| Credits & billing | 3 | 2 | 🟢 1 · 🟣 1 | Credits and billing |
| Support & system pages | 5 | 3 | 🟢 2 · 🟣 1 | Help, legal and system pages |

- Login & account access -> Main journey: tasks with AI coworkers: Log in
- Login & account access -> Onboarding: (First login, no workspace yet), (Open an invitation link)
- Onboarding -> Main journey: tasks with AI coworkers: Continue, (Accept)
- Main journey: tasks with AI coworkers -> Settings & account: You tab
- Main journey: tasks with AI coworkers -> Credits & billing: (Clear the search)
- Settings & account -> Main journey: tasks with AI coworkers: Schedules, Content Studio, Social Scheduling, Ads
- Settings & account -> Files & library: Files
- Settings & account -> Credits & billing: Credit history, Billing
- Settings & account -> Support & system pages: Help, Legal
- Login & account access -> Support & system pages: (Maintenance mode), (Unknown address), (Open a shared link)

## Stories

### Onboarding

First-run workspace setup and invitations.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-06 | As a new user, I want to choose a personal or organization workspace on my first login so that I land in the right place. | [First-run workspace setup](../screens/setup.png) | 🟣 unverified | note: A demo account without a workspace is redirected to Setup after login and sees the form. Submitting Continue was not run. |
| US-07 | As a new user, I want to accept an invitation to an organization so that I join my team's workspace. | Accept invitation | 🟣 unverified | note: Needs an invitation id from a second account. |

### Login & account access

Email, password and one-time-code sign-in, sign-up, password reset.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-01 | As a new user, I want to create an account with my email so that I can start using Sokosumi. | [Create account](../screens/signup.png) | 🟣 unverified | note: Form renders. Submit not run: sign-up needs an emailed code that the local build only prints to the Core console. |
| US-02 | As a workspace member, I want to log in with my email and password so that I reach my workspace. | [Sign in: email](../screens/signin-email.png), [Sign in: password](../screens/signin-password.png), [Home](../screens/home.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/(welcome)/page.tsx`; note: Logged in as two demo accounts through the UI: email step, password step, then Home (or Setup for the account without a workspace). |
| US-03 | As a workspace member, I want to see a clear message when my password is wrong so that I can fix it and try again. | [Sign in: password](../screens/signin-password.png), [Sign in: wrong password](../screens/signin-error.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(auth)/components/auth-flow.tsx`; note: A wrong password shows the toast 'Invalid email or password'. |
| US-04 | As a workspace member, I want to log in with a one-time code emailed to me so that I do not need my password. | [Sign in: password](../screens/signin-password.png), [Sign in: emailed code](../screens/signin-code.png) | 🟣 unverified | note: Code step renders with a resend timer; entering a code was not run. |
| US-05 | As a workspace member, I want to reset a forgotten password so that I get back into my account. | [Sign in: password](../screens/signin-password.png), [Forgot password](../screens/forgot-password.png) | 🟣 unverified | note: Reset form renders; sending the reset email was not run (no email provider locally). |

### Main journey: tasks with AI coworkers

Home, tasks, projects, chat, coworkers, schedules, studio.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-08 | As a workspace member, I want to land on a Home screen with a summary of the last 24 hours so that I see at a glance what my coworkers did. | [Home](../screens/home.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/(welcome)/page.tsx`; note: Welcome message and three counters (tasks completed, minutes worked, tasks needing input). |
| US-09 | As a workspace member, I want to switch between Everything and a single project so that I focus on one body of work. | [Home](../screens/home.png), [Project switcher](../screens/workspace-switcher.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/layout.tsx`; note: The switcher lists Everything, recent projects, Create project and Manage projects. |
| US-10 | As a workspace member, I want to see my tasks as a board by status so that I know what is in progress. | [Tasks: board](../screens/tasks-board.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/tasks/(root)/page.tsx`; note: Board columns Backlog, Todo and more, with demo tasks assigned to demo coworkers. |
| US-11 | As a workspace member, I want to see scheduled work on a calendar so that I know when things run. | [Tasks: calendar](../screens/tasks-calendar.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/tasks/(root)/page.tsx`; note: Agenda view renders; it was empty for the demo data ('No scheduled releases'). |
| US-12 | As a workspace member, I want to change how the board is displayed so that I can read it my way. | [Tasks: board](../screens/tasks-board.png), [Tasks: display menu](../screens/tasks-filter.png) | 🟣 unverified | note: The display menu (Board/List, Normal/Compact) opens; switching was not run. |
| US-13 | As a workspace member, I want to create a task and assign it to a coworker so that work starts without a meeting. | [Tasks: board](../screens/tasks-board.png), [New task](../screens/task-new.png) | 🟣 unverified | note: The New task sheet opens with assignee choices and Start from scratch. Submitting from the UI was not run (demo tasks were created through the Core API). |
| US-14 | As a workspace member, I want to open a task and see its status and activity so that I can follow what happened. | [Tasks: board](../screens/tasks-board.png), [Task detail](../screens/task-detail.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/tasks/[taskId]/page.tsx`; note: Detail shows identifier, status, assignee, project and an activity log. |
| US-15 | As a workspace member, I want to open a completed task and read its description, properties and parent task so that I can review finished work. | [Tasks: board](../screens/tasks-board.png), [Completed task (production, masked)](../screens/task-completed.png) | 🟢 built | verified: local demo + production task view, 2026-10-16; where: `apps/web/src/app/(app)/tasks/[taskId]/page.tsx`; note: Production: identifier, share and more buttons, Description, Properties, Auto tags, Parent task. Title, description, assignee, organization masked. |
| US-16 | As a workspace member, I want to edit a task so that I can correct the brief. | [Task detail](../screens/task-detail.png), [Edit task](../screens/task-edit.png) | 🟣 unverified | note: Edit form renders with the task's data. Saving was not run. |
| US-17 | As a workspace member, I want to browse my projects so that I find the right one quickly. | [Projects](../screens/projects.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/projects/(root)/page.tsx`; note: Two demo projects with briefings. |
| US-18 | As a workspace member, I want to create a project in three steps so that I can group related tasks. | [Projects](../screens/projects.png), [New project](../screens/project-new.png) | 🟣 unverified | note: Step 1 of 3 (name) renders; steps 2 and 3 and saving were not run. |
| US-19 | As a workspace member, I want to open a project and see its properties so that I understand its state. | [Project detail](../screens/project-detail.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/projects/[projectId]/page.tsx` |
| US-20 | As a workspace member, I want to see a project's memory setting so that I know what the coworkers remember. | [Project detail](../screens/project-detail.png), [Project memory](../screens/project-memory.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/projects/[projectId]/memory/page.tsx`; note: Memory is off for the demo project; the screen explains that. |
| US-21 | As a workspace member, I want to edit a project's name, website and briefing so that the coworkers get better context. | [Project detail](../screens/project-detail.png), [Edit project](../screens/project-edit.png) | 🟣 unverified | note: Edit form renders with data. Saving was not run. |
| US-22 | As a workspace member, I want to browse coworkers and open one so that I pick who to give work to. | [Coworker gallery](../screens/agents.png), [Coworker detail](../screens/agent-detail.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/agents/page.tsx`; note: Gallery groups three demo coworkers by vendor; detail has Start a new task. The Agent catalog (Hire) part is not shown on this build. |
| US-23 | As a workspace member, I want to see my chats and threads so that I can follow conversations. | [Chats](../screens/chat.png), [Threads](../screens/chat-threads.png), [Threads with real conversations (production, masked)](../screens/threads-live.png) | 🟢 built | verified: local demo + production threads, 2026-10-16; where: `apps/web/src/app/(app)/chat/threads/page.tsx`; note: Local: both screens show empty states. Production: Threads lists conversations by channel, replies and age (preview text masked). |
| US-24 | As a workspace member, I want to chat with a coworker in a room so that I can ask follow-up questions. | [Chats](../screens/chat.png), [Chat room (production, masked)](../screens/chat-room.png) | 🟢 built | verified: local demo + production chat room, 2026-10-16; where: `apps/web/src/app/(app)/chat/rooms/[roomId]/page.tsx`; note: Production: channel header, pin and thread buttons, message list, composer; names and messages masked. Sending not run. Locally the room needs realtime (Ably) keys. |
| US-25 | As a workspace member, I want to read my notifications so that I notice what needs me. | [Home](../screens/home.png), [Notifications inbox](../screens/notifications.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/notifications/page.tsx`; note: Inbox with tabs All, Unread, Needs you, Mentions; empty for the demo account. |
| US-26 | As a workspace member, I want to use a Soko Bot assistant so that a personal project manager delegates for me. | [Soko Bots](../screens/soko-bots.png), [Soko Bots with an active assistant (production)](../screens/soko-bots-live.png), [Personal assistant](../screens/personal-assistant.png) | 🟠 partly | note: Production: team intro, Chat button, assistant card with task count and last activity. Locally the assistant is unavailable. Chat and Settings not opened. |
| US-27 | As a workspace member, I want to set up a recurring task so that routine work happens by itself. | [Schedules](../screens/schedules.png), [New schedule](../screens/schedule-new.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/schedules/page.tsx`; note: List with filters and the New schedule form (title, details, repeat, time, ends). Creating a schedule was not run. |
| US-28 | As a workspace member, I want to generate images in the Content Studio so that I get visuals for my content. | [Content Studio](../screens/studio.png) | 🟠 partly | note: Prompt box, model and ratio pickers render; the template poster images show a broken-image icon in the local build and generating was not run. |
| US-29 | As a workspace member, I want to plan and publish social posts so that my campaign runs on schedule. | [Social scheduling (production)](../screens/social.png) | 🟠 partly | note: Production: week calendar with Calendar, Drafts, Needs attention tabs, Month/Week toggle. Only the calendar was viewed. Local demo gets a 404 (beta flag). |
| US-30 | As a workspace member, I want to manage ad campaigns so that I can run ads from a project. | [Ads: pick a project (production)](../screens/ads.png) | 🟠 partly | note: Production: only the Pick a project screen was viewed. Ad accounts and campaigns not opened. Local demo gets a 404 (beta flag). |

### Files & library

Files and tables produced in the workspace.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-31 | As a workspace member, I want to browse my files and tables so that I can find what coworkers produced. | [Files](../screens/drive.png), [Tables](../screens/drive-tables.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/drive/page.tsx`; note: Recent, Workspace and Tables tabs; empty for the demo account. |

### Settings & account

You menu, account, notifications, connections, developer tools, organization.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-32 | As an account owner, I want to see my credit balance and history so that I know what I have spent. | [You](../screens/you.png), [Credit history](../screens/credit-history.png), [Credit history with real usage (production, masked)](../screens/credit-history-live.png), [Search (credit history)](../screens/history-search.png) | 🟢 built | verified: local demo + production history, 2026-10-16; where: `apps/web/src/app/(app)/components/history-search-dialog-provider.tsx`; note: Balance on You, transactions on the history page, plus search. Production: 30-day spend chart, entries by month. Export CSV and filter not used. Avatars and one prompt title masked. |
| US-33 | As an account owner, I want to see my plan, usage limit and credits and reach every area from the You menu so that I can find any feature from one place. | [You](../screens/you.png), [You menu with plan, usage and all areas (production, masked)](../screens/you-live.png) | 🟢 built | verified: local demo + production You page, 2026-10-16; where: `apps/web/src/app/(app)/you/page.tsx`; note: Production: profile header (name, email, photo masked), plan badge, usage limit, extra credits, then the area entries incl. Admin. |
| US-34 | As an account owner, I want to reach internal admin tools from the You menu if my account is staff so that staff can operate the platform. | [You menu with plan, usage and all areas (production, masked)](../screens/you-live.png), [Admin tools landing (production)](../screens/admin.png) | 🟠 partly | note: Production: landing page lists Accounts and Billing tools. No admin page opened (other people's data). See G-06. |
| US-37 | As an account owner, I want to edit my profile, email and password so that my account stays accurate. | [You](../screens/you.png), [Account](../screens/account.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/account/page.tsx`; note: Profile image, name, email and password sections render. |
| US-38 | As an account owner, I want to choose which notifications I get and where so that I am not spammed. | [You](../screens/you.png), [Notification preferences](../screens/account-notifications.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/account/notifications/page.tsx`; note: Groups for Tasks, Chat, Billing, Project updates with In app, Push and Email. |
| US-39 | As an account owner, I want to connect Google and Microsoft accounts and see authorized apps so that coworkers can use my mail and calendar. | [Connections](../screens/connections.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/connections/page.tsx`; note: Both providers show 'is not connected'; connecting needs real OAuth credentials. |
| US-40 | As an account owner, I want to open my organization page so that I manage team settings. | [Organization](../screens/organization.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/organizations/[organizationSlug]/page.tsx`; note: Shows the organization, slug, design brief and brand settings. |
| US-41 | As a developer, I want to create and revoke API keys so that scripts can call Sokosumi. | [You](../screens/you.png), [Developer menu](../screens/you-developer.png), [API keys](../screens/api-keys.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/developer/api-keys/page.tsx`; note: Empty list with a Create button; creating a key was not run. |
| US-42 | As a developer, I want to register OAuth clients so that my app can sign in with Sokosumi. | [Developer menu](../screens/you-developer.png), [OAuth clients](../screens/oauth-clients.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/developer/oauth-clients/page.tsx`; note: Empty list with a Create OAuth client button. |
| US-43 | As a developer, I want to see my coworkers as a developer so that I can maintain them. | [Developer menu](../screens/you-developer.png), [Developer coworkers](../screens/dev-coworkers.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/developer/coworkers/page.tsx`; note: Empty list for the demo account (it has no developer coworkers). |
| US-44 | As a workspace member, I want to find help and the legal pages so that I can get support and read the terms. | [You](../screens/you.png), [Help](../screens/you-help.png), [Legal](../screens/you-legal.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/(app)/you/legal/page.tsx`; note: Help links to Documentation and Support; Legal lists terms, privacy, imprint and cookie settings. |

### Credits & billing

Credit balance and history, plan billing.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-35 | As an account owner, I want to manage my plan and billing details so that I stay on the right plan. | [Billing: access restricted (production)](../screens/billing.png) | 🟣 unverified | note: Needs an organization owner or admin. In production a member sees only the restricted message (US-36). Locally needs Stripe test keys. |
| US-36 | As an account owner, I want to be told clearly when I cannot view billing so that I know who to ask for access. | [Billing: access restricted (production)](../screens/billing.png) | 🟢 built | verified: production, read-only, 2026-10-16; where: `apps/web/src/app/(app)/billing/page.tsx`; note: Message: only organization owners and admins can view billing; switch context or ask an owner. |

### Support & system pages

Help, legal, maintenance, not found, shared links.

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-45 | As a workspace member, I want to see a maintenance page during downtime so that I know to come back later. | [Maintenance mode](../screens/maintenance.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/maintenance/page.tsx`; note: The page renders; the automatic redirect when MAINTENANCE_MODE is on was not exercised. |
| US-46 | As a workspace member, I want to see a friendly page for an unknown address so that I can get back home. | [Page not found](../screens/not-found.png) | 🟢 built | verified: local build, demo data, 2026-10-15; where: `apps/web/src/app/not-found.tsx` |
| US-47 | As a workspace member, I want to open a public link someone shared with me so that I can view it without an account. | Public share link | 🟣 unverified | note: Needs a public share link; not captured. |

### Unassigned

| ID | Story | Screens | Status | Evidence |
|---|---|---|---|---|
| US-48 | As a workspace member, I want to use Sokosumi from a native iPhone app so that I have it in my pocket. |  | ⚪ missing | where: `apps/apple/README.md`; note: Only a macOS app exists; apps/apple/README.md says iOS is planned and has no target yet. The web app is mobile-responsive and installable as a PWA. |

## Gaps and risks

### High

- **G-01 - No native iPhone or Android app** - The only native app is macOS (apps/apple). On phones people use the responsive web app or a PWA, so this map is for the web app at mobile width. Where: `apps/apple/README.md`. Stories: US-48.

### Medium

- **G-02 - Billing page shows a generic error when Stripe is not configured** - Opening Billing without Stripe keys gives 'Something went wrong. Try again' with no hint what is missing. Local-only, but a configuration failure in production would look the same. Where: `apps/web/src/app/(app)/billing/page.tsx`. Stories: US-35.
- **G-03 - Chat rooms need realtime keys locally; only seen in production** - Without Ably keys a local chat room shows a 'Something went wrong' modal (docs/agents/local-development.md). The room was captured read-only in production with its content masked, so message bubbles, reactions and threads inside a room are not mapped. Where: `docs/agents/local-development.md`. Stories: US-24.
- **G-07 - Sign-up and code sign-in cannot be completed locally** - Both need an emailed code; locally the code is only printed in the Core console, so the success path was not run. Where: `apps/web/src/app/(auth)/signup/page.tsx`. Stories: US-01, US-04.
- **G-09 - Billing could not be seen beyond the access-restricted message** - In the production workspace used for the capture a member only sees Billing access restricted. Plan, payment method and invoices need an organization owner or admin account, or the personal context, and were not captured; locally Billing needs Stripe test keys. Where: `apps/web/src/app/(app)/billing/page.tsx`. Stories: US-35.
- **G-11 - Public share page and invitation acceptance are not captured** - Both need a link or id that only a real shared task or a second account can create. They are marked not_captured and their stories stay unverified. Where: `apps/web/src/app/share/[token]/page.tsx`. Stories: US-47, US-07.

### Low

- **G-04 - Content Studio template images are broken in the local build** - The poster template shows a broken-image icon; likely the dummy blob token, not verified. Where: `apps/web/src/app/(app)/studio/page.tsx`. Stories: US-28.
- **G-05 - Social and Ads are beta-gated and only their entry screens are mapped** - The local demo account gets a 404 for /social and /ads. In production only the Social week calendar and the Ads Pick a project screen were viewed; Drafts, Needs attention, post creation, ad accounts and campaigns were not opened. Where: `apps/web/src/app/(app)/social/page.tsx`. Stories: US-29, US-30.
- **G-06 - Admin console is mapped only at its landing page** - About 40 routes under /admin plus the vendor and developer consoles are staff tools. Only the Admin landing page was viewed; no admin page was opened because they list other people's data. Where: `apps/web/src/app/(app)/admin/page.tsx`.
- **G-08 - /calendar redirects to the Tasks calendar tab** - There is no separate calendar screen; /calendar opens Tasks with the calendar view, so it is not mapped twice. Where: `apps/web/src/app/(app)/calendar/page.tsx`.
- **G-10 - Production screenshots are masked** - Ten production screens hide names, emails, avatars, the organization name and logo, chat and thread text and private task text behind grey blocks, so their content cannot be read by design. Layout, controls and numbers are real. Where: `docs/story-map/screens`.
