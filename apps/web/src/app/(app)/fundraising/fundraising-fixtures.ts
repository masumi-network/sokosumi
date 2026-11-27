import type {
  Contact,
  ContactSuggestion,
  FundraisingPath,
  FundraisingPaths,
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";

// Synthetic, fully typed fixtures for the fundraising tests: a contract change fails the test build.
const AT = new Date("2026-11-01T10:00:00Z");
const RESEARCH = {
  monthUsd: 0,
  capUsd: 25,
  perSearchUsd: 0.5,
  exaConfigured: true,
};

export function testContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "investor-1",
    score: null,
    name: "Ivy Investor",
    organization: "Example Fund",
    role: "Partner",
    location: null,
    summary: null,
    whyInteresting: null,
    stage: "INVESTOR",
    kind: "PERSON",
    nextStep: null,
    followUpAt: null,
    avatarUrl: null,
    customFields: {},
    firstContactAt: AT,
    lastContactAt: null,
    interactionCount: 0,
    lastInboundAt: null,
    awaitingReplySince: null,
    replyState: null,
    createdByUserId: null,
    createdBySokoBotId: null,
    mergedIntoId: null,
    version: 1,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    channels: [],
    lists: [],
    knownBy: [],
    user: null,
    ...overrides,
  };
}

export function testProspect(
  overrides: Partial<FundraisingProspect> = {},
): FundraisingProspect {
  return {
    contact: testContact(),
    stage: "TO_RESEARCH",
    stageChangedAt: null,
    owner: null,
    ticketSize: null,
    thesis: null,
    committedUsd: null,
    notes: null,
    source: null,
    lastDraftAt: null,
    lastDraftSubject: null,
    dataRoom: null,
    intro: { via: null, askedAt: null, madeAt: null, declinedAt: null },
    bestPath: null,
    ...overrides,
  };
}

export function testPipeline(
  overrides: Partial<FundraisingPipeline> = {},
): FundraisingPipeline {
  return {
    list: { id: "list-1", name: "Investors" },
    rooms: [],
    prospects: [testProspect()],
    research: RESEARCH,
    mailbox: null,
    ...overrides,
  };
}

/** A path through a contact at the investor's fund, held by a teammate. */
export function testFundPath(
  overrides: Partial<FundraisingPath> = {},
): FundraisingPath {
  return {
    kind: "fund",
    via: { id: "teammate-1", name: "Tess Teammate", image: null },
    linkedIn: false,
    through: {
      id: "connector-1",
      name: "Casey Connector",
      role: null,
      organization: "Example Fund",
      avatarUrl: null,
      email: "casey@example.com",
    },
    company: { name: "Example Fund", round: null, date: null },
    strength: 60,
    touches: 4,
    lastTouchAt: null,
    ...overrides,
  };
}

export function testPaths(paths: FundraisingPath[]): FundraisingPaths {
  return {
    portfolio: [],
    researchedAt: null,
    researchUsd: 0.1,
    paths,
    research: RESEARCH,
  };
}

export function testSuggestion(
  overrides: Partial<ContactSuggestion> = {},
): ContactSuggestion {
  return {
    id: "suggestion-1",
    listId: "list-1",
    profileUrl: "https://example.com/sam",
    name: "Sam Suggested",
    role: "Partner",
    organization: "Sample Capital",
    location: null,
    reason: "Leads seed rounds in agent tooling.",
    status: "SUGGESTED",
    contactId: null,
    createdAt: AT,
    ...overrides,
  };
}
