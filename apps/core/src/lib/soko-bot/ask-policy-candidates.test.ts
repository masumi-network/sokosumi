import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  connectionFindMany: vi.fn(),
  newsletterFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findMany: db.projectFindMany },
    projectSocialConnection: { findMany: db.connectionFindMany },
    newsletter: { findMany: db.newsletterFindMany },
  },
}));

import {
  prepareAskPolicyHints,
  validateAskPolicyProjectSelection,
} from "./ask-policy-candidates";
import {
  mentionedSocialProviders,
  mentionsNewsletter,
  namedProjectsIn,
} from "./ask-policy-match";

const P1 = { id: "01960001-0001-7001-8001-000000000001", name: "Acme Brand" };
const P2 = { id: "01960001-0001-7001-8001-000000000002", name: "Founder Desk" };
const P3 = { id: "01960001-0001-7001-8001-000000000003", name: "Lab Notes" };

const X1 = {
  id: "01960001-0001-7001-8001-0000000000a1",
  provider: "x",
  externalHandle: "acme_hq",
  project: P1,
};
const X2 = {
  id: "01960001-0001-7001-8001-0000000000a2",
  provider: "x",
  externalHandle: "founder_handle",
  project: P2,
};
const X1_ALT = {
  id: "01960001-0001-7001-8001-0000000000a3",
  provider: "x",
  externalHandle: "acme_dev",
  project: P1,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.projectFindMany.mockResolvedValue([P1, P2]);
  db.connectionFindMany.mockResolvedValue([]);
  db.newsletterFindMany.mockResolvedValue([]);
});

describe("ask-policy-match", () => {
  it("detects explicitly named social providers while ignoring quoted copy, URLs, and non-social X tokens", () => {
    expect(mentionedSocialProviders("Turn this report into 3 X posts")).toEqual(
      ["x"],
    );
    expect(mentionedSocialProviders("Schedule a tweet for tomorrow")).toEqual([
      "x",
    ]);
    expect(
      mentionedSocialProviders("Draft a LinkedIn update and an IG reel"),
    ).toEqual(["linkedin", "instagram"]);
    expect(
      mentionedSocialProviders(
        'Draft a LinkedIn post saying "Follow us on X and TikTok"',
      ),
    ).toEqual(["linkedin"]);
    expect(
      mentionedSocialProviders(
        "Read https://youtube.com/watch?v=123 and https://x.com/user/status/1",
      ),
    ).toEqual([]);
    expect(
      mentionedSocialProviders(
        "Make a 10x better 16x9 banner for OS X and Project X",
      ),
    ).toEqual([]);
  });

  it("detects newsletter mentions outside quotes and URLs", () => {
    expect(mentionsNewsletter("Draft this week's newsletter issue")).toBe(true);
    expect(
      mentionsNewsletter('Post "Subscribe to our newsletter" to LinkedIn'),
    ).toBe(false);
    expect(mentionsNewsletter("Read https://example.com/newsletter/12")).toBe(
      false,
    );
  });

  it("matches exact project names (>= 3 chars) or UUIDs outside quotes", () => {
    expect(namedProjectsIn("Generate images for Acme Brand", [P1, P2])).toEqual(
      [P1],
    );
    expect(
      namedProjectsIn('Write copy saying "Acme Brand rocks"', [P1, P2]),
    ).toEqual([]);
    expect(namedProjectsIn(`Use project ${P2.id} please`, [P1, P2])).toEqual([
      P2,
    ]);
    expect(
      namedProjectsIn("Draft an X post", [{ id: "id-short", name: "X" }]),
    ).toEqual([]);
  });
});

describe("prepareAskPolicyHints", () => {
  it("directs immediate use when 1 X account fits across a 2-project workspace", async () => {
    db.connectionFindMany.mockResolvedValue([X1]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Turn this doc into 3 X posts",
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("exactly 1 fitting X destination");
    expect(hints[0]).toContain("@acme_hq");
    expect(hints[0]).toContain(P1.id);
    expect(hints[0]).toContain(X1.id);
    expect(hints[0]).toContain("without asking which project or account");
  });

  it("directs asking once and changing nothing when 2 X accounts exist and none is named", async () => {
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Draft an X post about our release",
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain(
      "2 active X accounts in scope and none is named",
    );
    expect(hints[0]).toContain("@acme_hq");
    expect(hints[0]).toContain("@founder_handle");
    expect(hints[0]).toContain("ask the owner once");
    expect(hints[0]).toContain("make no changes until they answer");
  });

  it("does not emit a contradictory ask-again hint when an open account question already exists", async () => {
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Use the first X account",
      hasOpenAccountQuestion: true,
    });
    expect(hints).toEqual([]);
  });

  it("narrows to 1 fitting account when the request names @handle or unique project outside quotes", async () => {
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const byHandle = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Post on X from @founder_handle",
    });
    expect(byHandle[0]).toContain("exactly 1 fitting X destination");
    expect(byHandle[0]).toContain("@founder_handle");

    const quotedHandle = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: 'Draft an X post saying "Shoutout to @founder_handle"',
    });
    expect(quotedHandle[0]).toContain(
      "2 active X accounts in scope and none is named",
    );
  });

  it("allows using both named accounts when the owner explicitly names both", async () => {
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Draft X posts for both @acme_hq and @founder_handle",
    });
    expect(hints[0]).toContain("explicitly names 2 active X accounts");
    expect(hints[0]).toContain("Use those named destinations directly");
  });

  it("reports missing connection when 0 active accounts exist for the named network", async () => {
    db.connectionFindMany.mockResolvedValue([]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Schedule an Instagram post for Friday",
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("0 active Instagram accounts are connected");
    expect(hints[0]).toContain("make no social changes");
  });

  it("scopes shared project bots strictly to their single projectId and skips workspace project scans", async () => {
    db.connectionFindMany.mockResolvedValue([X1]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: P1.id,
      message: "Draft an X post for our launch",
    });
    expect(db.projectFindMany).not.toHaveBeenCalled();
    expect(db.connectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: {
            workspaceId: "ws-1",
            closedAt: null,
            closingAt: null,
            id: P1.id,
          },
        }),
      }),
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("exactly 1 fitting X destination");
  });

  it("directs direct use when only 1 open project exists in a workspace", async () => {
    db.projectFindMany.mockResolvedValue([P1]);
    const hints = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Generate three replacement hero images",
    });
    expect(db.connectionFindMany).not.toHaveBeenCalled();
    expect(db.newsletterFindMany).not.toHaveBeenCalled();
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("only 1 open project exists in scope");
    expect(hints[0]).toContain(P1.id);
  });

  it("handles 0, 1, and 2+ newsletters cleanly", async () => {
    db.newsletterFindMany.mockResolvedValueOnce([]);
    const none = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Draft a newsletter issue",
    });
    expect(none[0]).toContain("0 newsletters are set up");

    db.newsletterFindMany.mockResolvedValueOnce([
      { id: "nl-1", name: "Weekly Digest", projectId: P1.id, project: P1 },
    ]);
    const one = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Draft a newsletter issue",
    });
    expect(one[0]).toContain("exactly 1 fitting newsletter");
    expect(one[0]).toContain("Weekly Digest");

    db.newsletterFindMany.mockResolvedValueOnce([
      { id: "nl-1", name: "Weekly Digest", projectId: P1.id, project: P1 },
      { id: "nl-2", name: "Product Notes", projectId: P2.id, project: P2 },
    ]);
    const two = await prepareAskPolicyHints({
      workspaceId: "ws-1",
      projectId: null,
      message: "Draft a newsletter issue",
    });
    expect(two[0]).toContain("2 newsletters in scope and none is named");
  });
});

describe("validateAskPolicyProjectSelection", () => {
  it("refuses project_selection on a single-project shared bot", async () => {
    const refusal = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: P1.id,
      projectIds: [P1.id, P2.id],
      userMessage: "Draft a post",
    });
    expect(refusal).toContain("one project only");
    expect(refusal).toContain(P1.id);
    expect(db.projectFindMany).not.toHaveBeenCalled();
  });

  it("refuses project_selection when only 1 open project exists in workspace or matches projectIds", async () => {
    db.projectFindMany.mockResolvedValueOnce([P1]).mockResolvedValueOnce([P1]);
    const oneOpen = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, "closed-or-other"],
      userMessage: "Redo those images",
    });
    expect(oneOpen).toContain("only 1 open project in this workspace");

    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1]);
    const oneMatched = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, "other-workspace-project"],
      userMessage: "Redo those images",
    });
    expect(oneMatched).toContain("requires at least 2 open projects");
    expect(oneMatched).toContain(P1.id);
  });

  it("refuses project_selection when only 1 project has an active account for the named network", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    db.connectionFindMany.mockResolvedValue([X1]);
    const refusal = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Turn this PDF into 3 X posts",
    });
    expect(refusal).toContain("exactly 1 fitting X destination");
    expect(refusal).toContain("@acme_hq");
    expect(refusal).toContain(P1.id);
  });

  it("refuses project_selection when 1 project holds 2 accounts for the named network", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    db.connectionFindMany.mockResolvedValue([X1, X1_ALT]);
    const refusal = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Post this on X",
    });
    expect(refusal).toContain(`Only Project "${P1.name}"`);
    expect(refusal).toContain("@acme_hq, @acme_dev");
    expect(refusal).toContain("ask the owner once which X account");
  });

  it("refuses project_selection when 0 active accounts exist for the named network", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    db.connectionFindMany.mockResolvedValue([]);
    const refusal = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Post this on LinkedIn",
    });
    expect(refusal).toContain("0 active LinkedIn accounts connected");
  });

  it("refuses mixing non-fitting projects into a network picker and allows only fitting ones", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2, P3]);
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const mixed = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id, P3.id],
      userMessage: "Draft an X post",
    });
    expect(mixed).toContain("Only these projects have an active X account");
    expect(mixed).toContain(P1.name);
    expect(mixed).toContain(P2.name);
    expect(mixed).not.toContain(P3.name);

    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    db.connectionFindMany.mockResolvedValue([X1, X2]);
    const clean = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Draft an X post",
    });
    expect(clean).toBeNull();
  });

  it("refuses project_selection when the owner already named one of the projects outside quotes", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    const refusal = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Generate 3 replacement images for Acme Brand",
    });
    expect(refusal).toContain(`already names Project "${P1.name}"`);
  });

  it("allows genuine 2-project selection when workspace has 2+ unrelated open projects and none is named", async () => {
    db.projectFindMany
      .mockResolvedValueOnce([P1, P2])
      .mockResolvedValueOnce([P1, P2]);
    const allowed = await validateAskPolicyProjectSelection({
      workspaceId: "ws-1",
      botProjectId: null,
      projectIds: [P1.id, P2.id],
      userMessage: "Generate 3 replacement hero images",
    });
    expect(allowed).toBeNull();
  });
});
