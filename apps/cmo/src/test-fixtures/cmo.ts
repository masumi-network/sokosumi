import type { ChatRoomMessage, CmoOverview } from "@sokosumi/core-client";

/** The overview's one Marketing strategy version, approved at `approvedAt` or a draft. */
export function cmoStrategyVersion(
  approvedAt: Date | null,
  updatedAt: Date = new Date("2026-10-01T09:02:00Z"),
): Pick<CmoOverview, "strategyVersion" | "strategyVersions"> {
  const version = {
    id: "strategy-1",
    projectId: "project-1",
    createdAt: updatedAt,
    updatedAt,
    authorSokoBotId: "bot-1",
    authorUserId: null,
    approvedAt,
    approvedByUserId: approvedAt ? "user-1" : null,
  };
  return { strategyVersion: version, strategyVersions: [version] };
}

/** Whole, typed CMO API values for tests; pass a patch for what a test is about. */
export const cmoStrategy: NonNullable<CmoOverview["strategy"]> = {
  month: "2026-10",
  summary: "Founder led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [
    {
      id: "a",
      date: "2026-10-05",
      channel: "linkedin",
      title: "Why we built it",
      format: "post",
      status: "draft",
    },
  ],
  previews: [
    { kind: "post", channel: "linkedin", title: "Hello", body: "First post" },
    { kind: "ad", channel: "meta", title: "Try it", body: "Ad copy" },
  ],
};

export function cmoOverview(patch: Partial<CmoOverview> = {}): CmoOverview {
  return {
    id: "cmo-1",
    businessName: "Acme",
    websiteUrl: "https://acme.io",
    organizationSlug: null,
    projectName: "CMO.xyz · Acme",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
    roomId: "room-1",
    botStatus: "IDLE",
    learning: "done",
    work: null,
    brandVisual: null,
    brandMedia: null,
    brandBrainApprovedAt: null,
    projectLogo: null,
    onboardingStep: "done",
    mockBilling: false,
    mockPlan: null,
    mockPlanActivatedAt: null,
    routines: [
      {
        key: "cmo-daily-run",
        name: "Daily marketing run",
        when: "Every day at 09:00",
        description: "Prepares what the calendar has due.",
        nextRunAt: null,
        timezone: "Europe/Berlin",
      },
    ],
    subscriptionActive: false,
    viewerCanApprove: true,
    brandBrain: {
      summary: "Acme sells rockets.",
      voice: { tone: "Direct", do: [], dont: [], examples: [] },
      audience: ["Founders"],
      products: [],
      competitors: [],
      channels: [],
    },
    brandBrainUpdatedAt: new Date("2026-10-01T09:01:00Z"),
    strategy: cmoStrategy,
    media: [],
    ...cmoStrategyVersion(null, new Date("2026-10-01T09:02:00Z")),
    updates: [],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
    adProviders: [],
    connectAdsUrl: "http://web/ads?projectId=project-1",
    production: { state: "waiting", ready: 0, total: 0, finishedAt: null },
    measurement: [
      {
        provider: "google_analytics",
        name: "Google Analytics",
        measures: "Visits, where they come from and conversions",
        status: "connected",
      },
      {
        provider: "google_search_console",
        name: "Google Search Console",
        measures: "Searches, clicks and rankings",
        status: "none",
      },
      {
        provider: "shopify",
        name: "Shopify",
        measures: "Orders and revenue",
        status: "none",
      },
    ],
    mailingListSize: 0,
    subscribeUrl: "http://web/billing",
    billing: { plan: null, subscriptionStatus: null, availableCredits: 40 },
    posts: { draft: 2, scheduled: 1, published: 0, failed: 0 },
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...patch,
  };
}

/** A top-level message from Cuso in his room. */
export function cmoChatMessage(
  patch: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "m1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Plan is ready.",
    createdAt: new Date("2026-10-01T09:03:00Z"),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: {
      type: "sokoBot",
      sokoBot: {
        id: "bot-1",
        name: "Cuso",
        caption: null,
        image: null,
        avatarSeed: null,
        ownerUserId: "user-1",
        scope: "project",
        sharedRoomId: null,
        presence: "online",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    ...patch,
  };
}
