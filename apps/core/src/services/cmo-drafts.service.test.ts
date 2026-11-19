import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toolCalls: vi.fn(),
  posts: vi.fn(),
  workspace: vi.fn(),
  requireCuso: vi.fn(),
  files: vi.fn(),
  getSocialPost: vi.fn(),
  scheduleSocialPost: vi.fn(),
  approveSocialPost: vi.fn(),
  cancelSocialPost: vi.fn(),
  updateSocialPost: vi.fn(),
}));

const testCopy = vi.hoisted(() => ({ is: vi.fn(async () => false) }));
vi.mock("@/services/project-test-copy", async (original) => ({
  ...(await original<typeof import("@/services/project-test-copy")>()),
  isTestCopyProject: testCopy.is,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { findMany: mocks.toolCalls },
    socialPost: { findMany: mocks.posts },
    workspace: { findUniqueOrThrow: mocks.workspace },
  },
}));
vi.mock("@/lib/drive-blob", () => ({
  publicDriveUrl: async (sourceId: string) => `https://blob.test/${sourceId}`,
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: mocks.files,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  CmoConflictError: class CmoConflictError extends Error {},
  requireCuso: mocks.requireCuso,
}));
vi.mock("@/services/social-posts.service", () => ({
  getSocialPost: mocks.getSocialPost,
  scheduleSocialPost: mocks.scheduleSocialPost,
  approveSocialPost: mocks.approveSocialPost,
  cancelSocialPost: mocks.cancelSocialPost,
  updateSocialPost: mocks.updateSocialPost,
}));

import {
  approveCmoDraft,
  CMO_APPROVED_POST_DELAY_MS,
  cmoReportAttachments,
  declineCmoDraft,
  editCmoDraft,
  listCmoDrafts,
} from "./cmo-drafts.service";

const NOW = new Date("2026-11-18T18:00:00.000Z");
const VIDEO = {
  kind: "video",
  name: "studio-intro.mp4",
  size: 5_000_000,
  fileUrl: "https://blob.test/studio-intro.mp4",
  mimeType: "video/mp4",
  pathname: "drive/studio-intro.mp4",
};

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    provider: "x",
    text: "Studio gives creators a no-code way to sell.",
    status: "NEEDS_APPROVAL",
    revision: 0,
    scheduledAt: null,
    publishedUrl: null,
    media: [VIDEO],
    ...overrides,
  };
}

const SCOPE = {
  reports: [
    { id: "report-new", turnId: "turn-1", kind: "request" },
    { id: "report-old", turnId: "turn-1", kind: "request" },
    { id: "report-other", turnId: null, kind: "daily" },
  ],
  projectId: "project-1",
  workspaceId: "ws-1",
  organizationId: "org-1",
  userId: "user-1",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireCuso.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "ws-1",
  });
  mocks.workspace.mockResolvedValue({ organizationId: "org-1" });
  mocks.files.mockResolvedValue([]);
});

describe("cmoReportAttachments", () => {
  it("puts the draft a turn made, with its video, on that turn's newest report alone", async () => {
    mocks.toolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "get_video",
        targetId: null,
        result: { status: "SUCCEEDED", file: { id: "file-1" } },
      },
      {
        turnId: "turn-1",
        capability: "create_social_post",
        targetId: "post-1",
        result: {},
      },
    ]);
    mocks.posts.mockResolvedValue([post()]);

    const attachments = await cmoReportAttachments(SCOPE);

    expect([...attachments.keys()]).toEqual(["report-new"]);
    expect(attachments.get("report-new")).toEqual({
      posts: [
        {
          id: "post-1",
          provider: "x",
          text: "Studio gives creators a no-code way to sell.",
          status: "NEEDS_APPROVAL",
          revision: 0,
          scheduledAt: null,
          publishedUrl: null,
          media: [
            {
              kind: "video",
              url: "https://blob.test/studio-intro.mp4",
              name: "studio-intro.mp4",
            },
          ],
        },
      ],
      // The video is on the draft, so it is not shown a second time.
      media: [],
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["post-1"] },
          projectId: "project-1",
          marketingStrategyId: null,
        },
      }),
    );
  });

  it("leaves out a duplicate draft Cuso dropped in the same turn", async () => {
    mocks.toolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "create_social_post",
        targetId: "post-1",
        result: {},
      },
      {
        turnId: "turn-1",
        capability: "create_social_post",
        targetId: "post-2",
        result: {},
      },
      {
        turnId: "turn-1",
        capability: "cancel_social_post",
        targetId: "post-2",
        result: {},
      },
    ]);
    mocks.posts.mockResolvedValue([
      post(),
      post({ id: "post-2", status: "CANCELED" }),
    ]);

    const attachments = await cmoReportAttachments(SCOPE);

    expect(attachments.get("report-new")?.posts.map((p) => p.id)).toEqual([
      "post-1",
    ]);
  });

  it("shows a video the turn made without a post as the report's own media", async () => {
    mocks.toolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "get_video",
        targetId: null,
        result: { status: "RUNNING" },
      },
      {
        turnId: "turn-1",
        capability: "get_video",
        targetId: null,
        result: { status: "SUCCEEDED", file: { id: "file-1" } },
      },
    ]);
    mocks.files.mockResolvedValue([
      {
        id: "file-1",
        displayName: "studio-intro.mp4",
        mimeType: "video/mp4",
        sourceId: "source-1",
      },
    ]);

    const attachments = await cmoReportAttachments(SCOPE);

    expect(attachments.get("report-new")).toEqual({
      posts: [],
      media: [
        {
          kind: "video",
          url: "https://blob.test/source-1",
          name: "studio-intro.mp4",
        },
      ],
    });
    expect(mocks.files).toHaveBeenCalledWith(
      expect.objectContaining({ resourceIds: ["file-1"] }),
    );
  });

  it("reads nothing for reports without a turn and for the month's production", async () => {
    const attachments = await cmoReportAttachments({
      ...SCOPE,
      reports: [
        { id: "report-other", turnId: null, kind: "daily" },
        { id: "report-month", turnId: "turn-9", kind: "production" },
      ],
    });
    expect(attachments.size).toBe(0);
    expect(mocks.toolCalls).not.toHaveBeenCalled();
  });
});

describe("listCmoDrafts", () => {
  it("lists the Project's posts that wait for approval", async () => {
    mocks.posts.mockResolvedValue([post()]);
    const drafts = await listCmoDrafts("project-1");
    expect(drafts.map((draft) => draft.id)).toEqual(["post-1"]);
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          status: "NEEDS_APPROVAL",
          marketingStrategyId: null,
        },
      }),
    );
  });
});

describe("approveCmoDraft", () => {
  const target = {
    userId: "user-1",
    projectId: "project-1",
    postId: "post-1",
    revision: 0,
  };
  const scope = {
    projectId: "project-1",
    workspaceId: "ws-1",
    userId: "user-1",
    postId: "post-1",
  };

  it("sends a draft without a time out in two minutes", async () => {
    mocks.getSocialPost.mockResolvedValue(post());
    mocks.scheduleSocialPost.mockResolvedValue(post({ revision: 1 }));

    await approveCmoDraft(target);

    expect(mocks.scheduleSocialPost).toHaveBeenCalledWith({
      ...scope,
      revision: 0,
      scheduledAt: new Date(NOW.getTime() + CMO_APPROVED_POST_DELAY_MS),
    });
    expect(mocks.approveSocialPost).toHaveBeenCalledWith({
      ...scope,
      revision: 1,
    });
  });

  it("refuses to send a test copy's draft two minutes later, and changes nothing", async () => {
    testCopy.is.mockResolvedValueOnce(true);
    mocks.getSocialPost.mockResolvedValue(post());

    await expect(approveCmoDraft(target)).rejects.toThrow(
      "A test copy sends nothing at once",
    );
    expect(mocks.scheduleSocialPost).not.toHaveBeenCalled();
    expect(mocks.approveSocialPost).not.toHaveBeenCalled();
  });

  it("refuses a test copy's draft planned sooner than 12 hours ahead, and approves one planned later", async () => {
    testCopy.is.mockResolvedValue(true);
    mocks.getSocialPost.mockResolvedValue(
      post({ scheduledAt: new Date(NOW.getTime() + 11 * 60 * 60 * 1_000) }),
    );
    await expect(approveCmoDraft(target)).rejects.toThrow(
      "at least 12 hours ahead",
    );
    expect(mocks.approveSocialPost).not.toHaveBeenCalled();

    mocks.getSocialPost.mockResolvedValue(
      post({ scheduledAt: new Date(NOW.getTime() + 13 * 60 * 60 * 1_000) }),
    );
    await approveCmoDraft(target);
    expect(mocks.scheduleSocialPost).not.toHaveBeenCalled();
    expect(mocks.approveSocialPost).toHaveBeenCalledWith({
      ...scope,
      revision: 0,
    });
    testCopy.is.mockResolvedValue(false);
  });

  it("keeps a draft's own planned time", async () => {
    mocks.getSocialPost.mockResolvedValue(
      post({ scheduledAt: new Date("2026-11-20T09:00:00.000Z") }),
    );

    await approveCmoDraft(target);

    expect(mocks.scheduleSocialPost).not.toHaveBeenCalled();
    expect(mocks.approveSocialPost).toHaveBeenCalledWith({
      ...scope,
      revision: 0,
    });
  });

  it("leaves the draft waiting when its network refuses the time", async () => {
    mocks.getSocialPost.mockResolvedValue(post());
    mocks.scheduleSocialPost.mockRejectedValue(new Error("not connected"));

    await expect(approveCmoDraft(target)).rejects.toThrow("not connected");
    expect(mocks.approveSocialPost).not.toHaveBeenCalled();
  });

  it("refuses a draft that changed since it was shown", async () => {
    mocks.getSocialPost.mockResolvedValue(post({ revision: 3 }));

    await expect(approveCmoDraft(target)).rejects.toThrow(
      "This post changed. Look at it again.",
    );
    expect(mocks.scheduleSocialPost).not.toHaveBeenCalled();
  });
});

describe("declineCmoDraft and editCmoDraft", () => {
  const target = {
    userId: "user-1",
    projectId: "project-1",
    postId: "post-1",
    revision: 2,
  };

  it("cancels the post", async () => {
    await declineCmoDraft(target);
    expect(mocks.cancelSocialPost).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "ws-1",
      userId: "user-1",
      postId: "post-1",
      revision: 2,
    });
  });

  it("changes the words alone", async () => {
    await editCmoDraft({ ...target, text: "New words" });
    expect(mocks.updateSocialPost).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "ws-1",
      organizationId: "org-1",
      userId: "user-1",
      postId: "post-1",
      revision: 2,
      text: "New words",
    });
  });
});
