import { randomUUID } from "node:crypto";
import prisma from "@/lib/db/prisma";
import { INVESTOR_FIXTURE } from "@/services/evals/ownerbench/journeys";
import type { ReferenceScript, ScriptedToolCall } from "./world-check";

/**
 * Reference runs for the dev owner journeys, by journey id: the tool calls a
 * correct bot makes, played with no model by the world check. They are eval
 * fixtures, not bot code: ids come from the tools' own results, or, for a
 * project the owner names, from the turn's workspace. Held-out scripts stay
 * with the evaluator.
 */

async function projectId(turnId: string, name: string): Promise<string> {
  const { workspaceId } = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { workspaceId: true },
  });
  const project = await prisma.project.findFirstOrThrow({
    where: { workspaceId, name },
    select: { id: true },
  });
  return project.id;
}

/** A Coworker the runner set up for the running journey (its saved world). */
async function coworkerId(name: "Mira" | "CodePat"): Promise<string> {
  const running = await prisma.evalResult.findFirstOrThrow({
    where: { status: "RUNNING" },
    select: { state: true },
  });
  const id = (
    running.state as { world?: { coworkers?: Record<string, string> } } | null
  )?.world?.coworkers?.[name];
  if (!id) throw new Error(`World check: no ${name} in the journey's world`);
  return id;
}

/** Cuso works on his one Project: the bot's own. */
async function cusoProject(turnId: string): Promise<string> {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { sokoBot: { select: { projectId: true } } },
  });
  if (!turn.sokoBot.projectId)
    throw new Error("World check: Cuso has no Project");
  return turn.sokoBot.projectId;
}

/** Noon UTC on the next given weekday (0 Sunday … 6 Saturday), plus a day offset. */
function nextWeekday(weekday: number, offsetDays = 0): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((weekday - day.getUTCDay() + 7) % 7 || 7));
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString();
}

/** The owner's (and the checks') weekday: Europe/Berlin, not UTC. */
const berlinWeekday = (at: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(at));

interface ListedPost {
  id: string;
  text: string;
  status: string;
  provider: string;
  revision: number;
  scheduledAt: string | null;
}

const OPEN = ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"];
const openPosts = (results: Results) =>
  latest<ListedPost[]>(results, "posts").filter((post) =>
    OPEN.includes(post.status),
  );

type Results = readonly unknown[];

/** The newest result of a tool call that returned `key`. */
function latest<T>(results: Results, key: string): T {
  const found = [...results]
    .reverse()
    .find((result) => result && typeof result === "object" && key in result);
  if (!found) throw new Error(`World check: no tool result with "${key}"`);
  return (found as Record<string, T>)[key]!;
}

const call = (
  tool: string,
  input: Record<string, unknown>,
): ScriptedToolCall => ({
  tool,
  input,
});

const X_POSTS_FROM_PDF = [
  "Soko Bots now keep typed memory: every entry is dated, so you can see what it learned and when.",
  "When a fact changes, the old memory entry is marked Replaced instead of silently overwritten.",
  "Each night the bot's dreaming pass tidies its memory, so tomorrow starts from what is still true.",
];

// Names the scripts give what they make, so a later turn (a schedule's run,
// a Coworker's wake) is recognised by them.
const WEEKLY_REPORT = "Monday Coworker report";
const DAILY_POST = "Daily CodePat architecture post";
const HANDOFF_TASK = "Explain agent-to-agent hand-offs";
const RESEARCH_TASK = "Research EU AI-agent marketplaces";
const ARCHITECTURE_TASK = "Daily architecture note";

export const REFERENCE_SCRIPTS: Record<string, ReferenceScript> = {
  "owner-pdf-to-x-posts": {
    turns: [
      {
        match: "Typed memory launch",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_files", { query: "Typed memory launch" }),
            call("list_project_social_accounts", {
              projectId: await projectId(turnId, "Sokosumi Marketing"),
            }),
          ],
          (results) => [
            call("read_file", {
              fileId: latest<{ id: string }[]>(results, "files")[0]!.id,
            }),
          ],
          async (results, { turnId }) => {
            const account = latest<{ id: string; provider: string }[]>(
              results,
              "accounts",
            ).find((each) => each.provider === "x")!;
            const project = await projectId(turnId, "Sokosumi Marketing");
            return X_POSTS_FROM_PDF.map((text) =>
              call("create_social_post", {
                projectId: project,
                socialConnectionId: account.id,
                text,
              }),
            );
          },
          () =>
            "Three X drafts for Sokosumi are ready for your approval: Monday, Wednesday and Friday next week.",
        ],
      },
    ],
  },

  "owner-no-x-account": {
    turns: [
      {
        match: "my Padierfind account",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_project_social_accounts", {
              projectId: await projectId(turnId, "Padierfind"),
            }),
          ],
          () =>
            'Padierfind has no X account connected, so I drafted nothing. Connect one in Padierfind\'s Project Social, then I can save this as a draft: "We shipped typed memory and background runs for Soko Bots this week."',
        ],
      },
    ],
  },

  "owner-which-x-account": {
    turns: [
      {
        match: "We just crossed 1,000 Soko Bots",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          () =>
            "Which X account should this go on: @sokosumi (Sokosumi Marketing) or @padierfind (Padierfind)?",
        ],
      },
      {
        match: "The Sokosumi one.",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_project_social_accounts", {
              projectId: await projectId(turnId, "Sokosumi Marketing"),
            }),
          ],
          async (results, { turnId }) => [
            call("create_social_post", {
              projectId: await projectId(turnId, "Sokosumi Marketing"),
              socialConnectionId: xAccount(results),
              text: "We just crossed 1,000 Soko Bots at work.",
            }),
          ],
          () =>
            "It's drafted on @sokosumi and waits for your approval. Say publish and it goes out.",
        ],
      },
    ],
  },

  "owner-stale-schedules": {
    turns: [
      {
        match: "which schedules are kinda outdated",
        route: { route: "DIRECT_RESPONSE" },
        steps: [
          () => [call("list_schedules", { scope: "workspace" })],
          () =>
            'Jami made four of the workspace\'s schedules. Three look outdated: "Daily competitor scan" has failed its last runs, "Morning competitor check" overlaps it and your own "Competitor news", and "Q3 launch countdown" is disabled and about a launch that is over. "Weekly investor update draft" is healthy, so I would keep it. I changed nothing. Should I message Jami about removing the three?',
        ],
      },
    ],
  },

  "owner-site-to-newsletter": {
    turns: [
      {
        match: "Sokosumi Updates issue",
        route: { route: "MANAGE_WORK", writeScope: "WORK" },
        steps: [
          () => [call("web_fetch", { url: "https://www.sokosumi.com" })],
          async (_results, { turnId }) => [
            call("newsletter_draft_issue", {
              projectId: await projectId(turnId, "Sokosumi Marketing"),
              brief:
                "Introduce Sokosumi to new subscribers, using only what www.sokosumi.com says: what it is, who it is for, and how to start.",
            }),
          ],
          () =>
            "This week's Sokosumi Updates issue is drafted and not sent. Preview and approve it in the newsletter.",
        ],
      },
    ],
  },

  "owner-images-redo": {
    turns: [
      {
        match: "2 square images",
        route: { route: "MANAGE_WORK", writeScope: "FILE" },
        steps: [
          async (_results, { turnId }) => {
            const project = await projectId(turnId, "Sokosumi Marketing");
            return ["announcement", "save the date"].map((angle) =>
              call("generate_image", {
                projectId: project,
                prompt: `Square image for an X post announcing the Sokosumi Berlin meetup on December 12 (${angle}): dark grey background, white text, minimal.`,
                aspectRatio: "1:1",
                maxCredits: 50,
              }),
            );
          },
          () =>
            "Both square images for the Berlin meetup are generating; they appear here when ready.",
        ],
      },
      {
        match: "Make them darker and drop the date",
        route: { route: "MANAGE_WORK", writeScope: "FILE" },
        steps: [
          async (_results, { turnId }) => {
            const project = await projectId(turnId, "Sokosumi Marketing");
            return ["announcement", "invitation"].map((angle) =>
              call("generate_image", {
                projectId: project,
                prompt: `Square image for an X post announcing the Sokosumi Berlin meetup (${angle}): near-black background, white text, minimal, no date.`,
                aspectRatio: "1:1",
                maxCredits: 50,
              }),
            );
          },
          () =>
            "Two new versions are generating: darker, and without the date.",
        ],
      },
    ],
  },

  "owner-investor-table": {
    turns: [
      {
        match: "Seed investor notes",
        route: {
          route: "MANAGE_WORK",
          writeScope: "FILE",
          complexity: "COMPLEX",
        },
        steps: [
          () => [call("list_files", { query: "Seed investor notes" })],
          (results) => [
            call("read_file", {
              fileId: latest<{ id: string }[]>(results, "files")[0]!.id,
            }),
          ],
          () => {
            const column = {
              fund: randomUUID(),
              partner: randomUUID(),
              deal: randomUUID(),
              source: randomUUID(),
            };
            return [
              call("create_table", {
                key: "seed-investors-ai-agents",
                title: "European seed investors in AI agents",
                columns: [
                  { id: column.fund, name: "Fund", type: "text" },
                  { id: column.partner, name: "Partner", type: "text" },
                  { id: column.deal, name: "Recent deal", type: "text" },
                  { id: column.source, name: "Source", type: "url" },
                ],
                rows: INVESTOR_FIXTURE.fits.slice(0, 10).map((fit) => ({
                  values: {
                    [column.fund]: fit.fund,
                    [column.partner]: fit.partner,
                    [column.deal]: `${fit.startup} seed round`,
                    [column.source]: fit.source,
                  },
                  evidence: { [column.deal]: [{ url: fit.source }] },
                })),
              }),
            ];
          },
          () =>
            `The table has 10 fitting investors from your notes. Top 5 for us: ${INVESTOR_FIXTURE.fits
              .slice(0, 5)
              .map((fit) => fit.fund)
              .join(
                ", ",
              )}; each led a seed round in an AI-agent startup this year.`,
        ],
      },
    ],
  },

  "owner-cuso-ambiguous-more": {
    turns: [
      {
        match: "Can you do more on Instagram?",
        steps: [
          () =>
            "Your plan has no Instagram yet and no Instagram account is connected. Should I add Instagram to the plan once you connect it, or put that effort into LinkedIn instead?",
        ],
      },
    ],
  },

  "owner-cuso-launch": {
    turns: [
      {
        match: "I want to launch something new",
        steps: [
          () =>
            "What are you launching, when does it go live, and who is it for?",
        ],
      },
      {
        match: "Routing Forms AI",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_project_social_accounts", {
              projectId: await cusoProject(turnId),
            }),
          ],
          async (results, { turnId }) => {
            const project = await cusoProject(turnId);
            const accounts = cusoAccounts(results);
            return [
              ["Something new for sales teams lands Tuesday.", -1],
              [
                "Routing Forms AI is live: every lead goes to the right person on your team automatically.",
                0,
              ],
              [
                "One day in with Routing Forms AI: leads reach the right rep without anyone sorting them.",
                1,
              ],
            ].map(([text, offset], index) =>
              call("create_social_post", {
                projectId: project,
                socialConnectionId: accounts[index % accounts.length],
                text,
                scheduledAt: nextWeekday(2, offset as number),
              }),
            );
          },
          () =>
            "Three launch pieces are planned around Tuesday: a teaser the day before, the launch, and a follow-up. They wait for your approval.",
        ],
      },
      {
        match: "Push the launch to Thursday",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_social_posts", {
              projectId: await cusoProject(turnId),
              search: "Routing Forms",
              limit: 100,
            }),
          ],
          async (results, { turnId }) => {
            const project = await cusoProject(turnId);
            return openPosts(results).map((post) =>
              call("schedule_social_post", {
                projectId: project,
                postId: post.id,
                revision: post.revision,
                scheduledAt: new Date(
                  new Date(post.scheduledAt ?? nextWeekday(2)).getTime() +
                    2 * 86_400_000,
                ).toISOString(),
                timezone: "Europe/Berlin",
              }),
            );
          },
          () =>
            "The launch pieces moved two days: teaser Wednesday, launch Thursday, follow-up Friday.",
        ],
      },
      {
        match: "Put $300 of ads behind launch week",
        steps: [
          () =>
            "A $300 search campaign for launch week needs your Google Ads account connected; I have not launched anything.",
        ],
      },
    ],
  },

  "owner-cuso-youtube": {
    turns: [
      {
        match: "I made a YouTube video",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_project_social_accounts", {
              projectId: await cusoProject(turnId),
            }),
          ],
          async (results, { turnId }) => {
            const project = await cusoProject(turnId);
            const accounts = cusoAccounts(results);
            return [
              "New video: how routing sends every lead to the right person. Watch it on YouTube.",
              "Two minutes on routing forms, from our new YouTube video.",
            ].map((text, index) =>
              call("create_social_post", {
                projectId: project,
                socialConnectionId: accounts[index % accounts.length],
                text,
              }),
            );
          },
          () =>
            "I can't read what the video says, so I built two pieces that point to it. Send me its transcript and I'll quote it.",
        ],
      },
    ],
  },

  "owner-cuso-pricing-page": {
    turns: [
      {
        match: "We changed our pricing",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("web_fetch", { url: "https://cal.com/pricing" }),
            call("list_social_posts", {
              projectId: await cusoProject(turnId),
              limit: 100,
            }),
          ],
          async (results, { turnId }) => {
            const project = await cusoProject(turnId);
            // After a web read the turn may edit its own drafts but not
            // cancel (web taint), so the old price is rewritten.
            return openPosts(results)
              .filter((post) => /\$9\b/.test(post.text))
              .map((post) =>
                call("update_social_post", {
                  projectId: project,
                  postId: post.id,
                  revision: post.revision,
                  text: "Cal.com Teams brings round-robin, routing forms and collective events to the whole team. Try it free.",
                }),
              );
          },
          () =>
            "One upcoming post still quoted the old $9 price, so I took the price out. Nothing else coming up mentions prices.",
        ],
      },
    ],
  },

  "owner-cuso-change-plan": {
    turns: [
      {
        match: "no posts on Fridays",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_social_posts", {
              projectId: await cusoProject(turnId),
              limit: 100,
            }),
          ],
          async (results, { turnId }) => {
            const project = await cusoProject(turnId);
            const open = openPosts(results);
            const fridays = open.filter(
              (post) =>
                post.scheduledAt && berlinWeekday(post.scheduledAt) === "Fri",
            );
            const linkedIn = open.find(
              (post) => post.provider === "linkedin" && !fridays.includes(post),
            );
            return [
              // Only schedule_social_post moves a post's date.
              ...fridays.map((post) =>
                call("schedule_social_post", {
                  projectId: project,
                  postId: post.id,
                  revision: post.revision,
                  scheduledAt: new Date(
                    new Date(post.scheduledAt!).getTime() - 86_400_000,
                  ).toISOString(),
                  timezone: "Europe/Berlin",
                }),
              ),
              ...(linkedIn
                ? [
                    call("cancel_social_post", {
                      projectId: project,
                      postId: linkedIn.id,
                      revision: linkedIn.revision,
                    }),
                  ]
                : []),
              call("create_social_post", {
                projectId: project,
                text: "Booking a team meeting should take one link, not ten emails.",
              }),
            ];
          },
          () =>
            "Friday posts moved to Thursday, one LinkedIn post is cancelled and a new X post takes its place.",
        ],
      },
    ],
  },

  "owner-cuso-report-then-act": {
    turns: [
      {
        match: "How did last week go",
        steps: [
          () => [call("read_report", {})],
          () =>
            "Last week posts that opened with a customer's number got twice the clicks. Should I open the next LinkedIn pieces with a customer number?",
        ],
      },
      {
        match: "OK, do that.",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_social_posts", {
              projectId: await cusoProject(turnId),
              limit: 100,
            }),
          ],
          async (results, { turnId }) => {
            const post = openPosts(results)[0];
            if (!post) return "There is no upcoming piece to change.";
            return [
              call("update_social_post", {
                projectId: await cusoProject(turnId),
                postId: post.id,
                revision: post.revision,
                text: "4,210 people saw our LinkedIn posts last week. Here is what they clicked.",
              }),
            ];
          },
          () => "The next LinkedIn piece now opens with a customer number.",
        ],
      },
    ],
  },

  "owner-cuso-customer-story": {
    turns: [
      {
        match: "Northwind customer story",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          () => [call("list_files", { query: "Northwind customer story" })],
          (results) => [
            call("read_file", {
              fileId: latest<{ id: string }[]>(results, "files")[0]!.id,
            }),
          ],
          async (_results, { turnId }) => {
            const project = await cusoProject(turnId);
            return [
              "Northwind's team cut scheduling work by 43% after switching to Cal.com.",
              "Northwind gets 11 hours a week back from booking meetings.",
            ].map((text) =>
              call("create_social_post", { projectId: project, text }),
            );
          },
          () =>
            "Two pieces this month now use the Northwind story as proof: the 43% and the 11 hours.",
        ],
      },
    ],
  },

  "owner-weekly-report-schedule": {
    turns: [
      {
        match: "Every Monday at 8:00 send me a short report",
        route: { route: "MANAGE_WORK", writeScope: "SCHEDULE" },
        steps: [
          () => [
            call("create_schedule", {
              name: WEEKLY_REPORT,
              cronExpression: "0 8 * * 1",
              timezone: "Europe/Berlin",
              prompt:
                "Send the owner a short report: what their Coworkers finished last week, what is stuck or blocked, and what is waiting on them.",
            }),
          ],
          () =>
            "Every Monday at 8:00 Berlin time you get a short report: finished, stuck, and waiting on you.",
        ],
      },
      {
        match: `Schedule "${WEEKLY_REPORT}"`,
        steps: [
          () => [call("list_tasks", {})],
          () =>
            "Last week: nothing finished, nothing stuck, and nothing is waiting on you.",
        ],
      },
      {
        match: "Move it to 7:30 and drop the stuck part",
        route: { route: "MANAGE_WORK", writeScope: "SCHEDULE" },
        steps: [
          () => [
            call("update_schedule", {
              scheduleName: WEEKLY_REPORT,
              cronExpression: "30 7 * * 1",
              prompt:
                "Send the owner a short report: what their Coworkers finished last week, and what is waiting on them.",
              keepCapabilities: true,
            }),
          ],
          () =>
            "The Monday report now comes at 7:30 and no longer covers what's stuck.",
        ],
      },
    ],
  },

  "owner-codepat-busy": {
    turns: [
      {
        match: "Ask CodePat to write up how our agent-to-agent hand-offs work",
        route: { route: "MANAGE_WORK", writeScope: "WORK" },
        steps: [
          async () => [
            call("create_task", {
              name: HANDOFF_TASK,
              description:
                "Write up how our agent-to-agent hand-offs (a2a) work, for an X post on Padierfind.",
              coworkerId: await coworkerId("CodePat"),
              status: "READY",
            }),
          ],
          () =>
            "CodePat has the write-up as a Task. When it's back I'll draft the X post on Padierfind with one image.",
        ],
      },
      {
        match: `Task "${HANDOFF_TASK}"`,
        steps: [
          () =>
            "CodePat can't take the hand-off write-up until Monday, so there is no post yet. Should I ask Mira instead, or send it to CodePat again next week?",
        ],
      },
    ],
  },

  "owner-research-to-linkedin": {
    turns: [
      {
        match: "Have Mira research the three biggest EU AI-agent marketplaces",
        route: {
          route: "MANAGE_WORK",
          writeScope: "WORK",
          complexity: "COMPLEX",
        },
        steps: [
          async () => [
            call("create_task", {
              name: RESEARCH_TASK,
              description:
                "Research the three biggest EU AI-agent marketplaces: their pricing and their funding.",
              coworkerId: await coworkerId("Mira"),
              status: "READY",
              // The owner asked for the post and the image now: the wake that
              // carries it out inherits that, within these limits.
              followUp:
                "Turn Mira's findings into a LinkedIn draft for utxo AG with one simple chart-style image, then tell the owner it is ready.",
              followUpAllows: { images: 1, maxCredits: 50 },
            }),
          ],
          () =>
            "Mira has the research. When her findings are in, I'll draft the LinkedIn post for utxo AG with a chart-style image.",
        ],
      },
      {
        match: `Task "${RESEARCH_TASK}"`,
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("generate_image", {
              projectId: await projectId(turnId, "utxo AG Outreach"),
              prompt:
                "Simple bar chart, white background: funding of AgentHub EU (EUR 12M), Botmarkt (EUR 4.5M) and Sokosumi (EUR 3M).",
              aspectRatio: "1:1",
              maxCredits: 50,
            }),
            call("list_project_social_accounts", {
              projectId: await projectId(turnId, "utxo AG Outreach"),
            }),
          ],
          (results) => readImages(results),
          async (results, { turnId }) => [
            call("create_social_post", {
              projectId: await projectId(turnId, "utxo AG Outreach"),
              socialConnectionId: latest<{ id: string; provider: string }[]>(
                results,
                "accounts",
              ).find((account) => account.provider === "linkedin")?.id,
              text: "The three biggest EU AI-agent marketplaces: AgentHub EU raised EUR 12M, Botmarkt charges EUR 49 a seat after a EUR 4.5M seed, and Sokosumi prices by Task.",
              ...mediaFrom(results),
            }),
          ],
          () =>
            "The LinkedIn draft for utxo AG with Mira's numbers and the chart is ready for your approval.",
        ],
      },
    ],
  },

  "owner-codepat-daily-post": {
    turns: [
      {
        match: "Create a schedule that once a day has Codepat review",
        route: { route: "MANAGE_WORK", writeScope: "SCHEDULE" },
        steps: [
          () => [
            call("create_schedule", {
              name: DAILY_POST,
              cronExpression: "0 9 * * *",
              timezone: "Europe/Berlin",
              prompt:
                "Ask CodePat to review the Sokosumi source code and write a short architecture note on one thing we do a certain way, such as memory or Soko Bots. Then make 2-3 minimal images (white background, black text, a few bullet points) and prepare a draft X post on the Padierfind account for the owner to approve.",
            }),
          ],
          () =>
            "Every day at 9:00 CodePat writes an architecture note, and you get 2-3 images and a Padierfind X draft to approve.",
        ],
      },
      {
        match: `Schedule "${DAILY_POST}"`,
        steps: [
          async () => [
            call("create_task", {
              name: ARCHITECTURE_TASK,
              description:
                "Review the Sokosumi source code (the repo) and write a short architecture note on one thing we do a certain way, for a social post on X.",
              coworkerId: await coworkerId("CodePat"),
              status: "READY",
              followUp:
                "Make 2-3 minimal images from CodePat's note (white background, black text, bullet points) and a draft X post on Padierfind for the owner to approve.",
              followUpAllows: { images: 3, maxCredits: 150 },
            }),
          ],
          () => "CodePat has today's architecture note.",
        ],
      },
      {
        match: `Task "${ARCHITECTURE_TASK}"`,
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => {
            const project = await projectId(turnId, "Padierfind");
            return [
              ...[1, 2].map((part) =>
                call("generate_image", {
                  projectId: project,
                  prompt: `Minimal image ${part} of 2 on how Soko Bots remember: white background, black text, three bullet points.`,
                  aspectRatio: "1:1",
                  maxCredits: 50,
                }),
              ),
              call("list_project_social_accounts", { projectId: project }),
            ];
          },
          (results) => readImages(results),
          async (results, { turnId }) => [
            call("create_social_post", {
              projectId: await projectId(turnId, "Padierfind"),
              socialConnectionId: xAccount(results),
              text: "How Soko Bots remember: every memory entry is dated, and a changed fact replaces the old one instead of piling up.",
              ...mediaFrom(results),
            }),
          ],
          () =>
            "Today's Padierfind X draft with two images is ready. Approve it and it goes out.",
        ],
      },
      {
        match: "Nice. Skip Fridays though.",
        route: { route: "MANAGE_WORK", writeScope: "SCHEDULE" },
        steps: [
          () => [
            call("update_schedule", {
              scheduleName: DAILY_POST,
              cronExpression: "0 9 * * 0,1,2,3,4,6",
              keepCapabilities: true,
            }),
          ],
          () => "Done: the daily post now skips Fridays.",
        ],
      },
      {
        match: "make the post shorter, under 200 characters",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_social_posts", {
              projectId: await projectId(turnId, "Padierfind"),
              limit: 20,
            }),
          ],
          async (results, { turnId }) => {
            const post = openPosts(results)[0];
            if (!post) return "There is no Padierfind draft to shorten.";
            return [
              call("update_social_post", {
                projectId: await projectId(turnId, "Padierfind"),
                postId: post.id,
                revision: post.revision,
                text: "Soko Bots date every memory, and a changed fact replaces the old one.",
              }),
            ];
          },
          () => "The draft is shorter now, under 200 characters.",
        ],
      },
    ],
  },
};

/** get_image for every image job the turn started, so each lands in Files. */
function readImages(results: Results): ScriptedToolCall[] {
  return results.flatMap((result) => {
    const job = result as { jobId?: unknown; projectId?: unknown } | null;
    return typeof job?.jobId === "string" && typeof job.projectId === "string"
      ? [call("get_image", { projectId: job.projectId, jobId: job.jobId })]
      : [];
  });
}

/** What a private (held-out) scripts file is given to write its scripts with. */
export const SCRIPT_HELPERS = {
  call,
  latest,
  openPosts,
  projectId,
  cusoProject,
  coworkerId,
  nextWeekday,
  mediaFrom,
  readImages,
  xAccount,
};

/** Media for a post: the Drive files of images made earlier in the turn, if any. */
function mediaFrom(results: Results): { media?: { fileId: string }[] } {
  // get_image answers a ready image with its Files copy as `file`.
  const fileIds = results.flatMap((result) => {
    const fileId = (result as { file?: { id?: unknown } } | null)?.file?.id;
    return typeof fileId === "string" ? [fileId] : [];
  });
  return fileIds.length ? { media: fileIds.map((fileId) => ({ fileId })) } : {};
}

/** Cuso's connected accounts, LinkedIn first: one id per network. */
function cusoAccounts(results: Results): string[] {
  return latest<{ id: string; provider: string }[]>(results, "accounts")
    .sort((a, b) =>
      a.provider === "linkedin" ? -1 : b.provider === "linkedin" ? 1 : 0,
    )
    .map((account) => account.id);
}

function xAccount(results: Results): string {
  return latest<{ id: string; provider: string }[]>(results, "accounts").find(
    (account) => account.provider === "x",
  )!.id;
}
