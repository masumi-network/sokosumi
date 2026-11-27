import type { SocialPostProvider } from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/evlog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evlog")>()),
  tryUseLogger: () => null,
}));

import { projectComposioFetch } from "@/clients/composio.client";
import { fetchSocialAccountStatisticsPage } from "@/clients/social-post-providers/account-statistics";
import {
  commentsReadable,
  listPostComments,
  listXReplies,
  replyToComment,
} from "@/clients/social-post-providers/comments";
import { publishSocialPostFirstComment } from "@/clients/social-post-providers/first-comment";
import { publishSocialPostToProvider } from "@/clients/social-post-providers/index";
import { fetchSocialPostStatistics } from "@/clients/social-post-providers/statistics";
import { zernioRequest } from "@/clients/zernio.client";
import {
  EVAL_POST_METRICS,
  EvalExternalCallError,
} from "@/lib/evals/eval-social-account";

const NETWORKS: SocialPostProvider[] = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
];
const STAND_IN = "eval:eval-3-cuso-x";
const fetchMock = vi.fn(async () => {
  throw new Error("no network in this test");
});

beforeEach(() => {
  getEnvMock.mockReturnValue({
    COMPOSIO_API_KEY: "key",
    ZERNIO_API_KEY: "key",
  });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("an eval stand-in account", () => {
  it.each(NETWORKS)(
    "publishes, reads and answers on %s without a network call",
    async (provider) => {
      const account = {
        provider,
        connectedAccountId: STAND_IN,
        executorUserId: "owner",
        externalAccountId: "eval-3-cuso",
      };
      const post = {
        ...account,
        postId: "post-1",
        externalHandle: "evalbrand",
        text: "Launch day.",
        media: [],
        firstComment: "Link in here.",
      };
      const published = await publishSocialPostToProvider(post);
      expect(published).toMatchObject({
        externalId: expect.stringMatching(new RegExp(`^eval-${provider}-`)),
        publishedUrl: expect.stringContaining("https://evals.invalid/"),
        firstCommentIncluded: true,
      });
      expect(await publishSocialPostToProvider(post)).toEqual(published);
      expect(
        (await publishSocialPostToProvider({ ...post, text: "Part two." }))
          .externalId,
      ).not.toBe(published.externalId);
      await publishSocialPostFirstComment({
        ...account,
        externalId: published.externalId ?? "",
        text: "Link in here.",
      });
      expect(
        await fetchSocialPostStatistics({ ...account, externalId: "eval-1" }),
      ).toEqual(EVAL_POST_METRICS);
      const page = await fetchSocialAccountStatisticsPage({
        ...account,
        externalHandle: "evalbrand",
        cursor: null,
        includeProfile: true,
      });
      expect(page).toMatchObject({
        accountError: null,
        posts: [],
        accountMetrics: [expect.objectContaining({ key: "followers_count" })],
      });
      if (provider !== "x") {
        const comments = { ...account, provider };
        expect(commentsReadable(comments.provider, STAND_IN)).toBe(true);
        expect(await listPostComments(comments, "eval-1")).toEqual([]);
        expect(
          await replyToComment(
            comments,
            {
              externalCommentId: "c-1",
              externalPostId: "eval-1",
              idempotencyKey: "comment-1",
            },
            "Thanks!",
          ),
        ).toBe("eval-reply-comment-1");
      } else {
        expect(
          await listXReplies(
            { ...account, provider: "x" },
            { startTime: new Date() },
          ),
        ).toEqual([]);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("the network clients", () => {
  it("refuse a request that names a stand-in account, before any fetch", async () => {
    await expect(
      projectComposioFetch(
        `/api/v3.1/connected_accounts/${encodeURIComponent(STAND_IN)}/revoke`,
      ),
    ).rejects.toThrow(EvalExternalCallError);
    await expect(
      projectComposioFetch("/api/v3.1/tools/execute/proxy", {
        method: "POST",
        jsonBody: { connected_account_id: STAND_IN, endpoint: "/me" },
      }),
    ).rejects.toThrow(EvalExternalCallError);
    await expect(
      projectComposioFetch("/api/v3.1/tool_router/session", {
        method: "POST",
        jsonBody: { connected_accounts: { twitter: [STAND_IN] } },
      }),
    ).rejects.toThrow(EvalExternalCallError);
    await expect(
      zernioRequest(`/inbox/comments/p?accountId=${STAND_IN}`),
    ).rejects.toThrow(EvalExternalCallError);
    await expect(
      zernioRequest("/posts", {
        method: "POST",
        body: { accountId: STAND_IN },
      }),
    ).rejects.toThrow(EvalExternalCallError);
    await expect(
      zernioRequest("/posts", {
        method: "POST",
        body: {
          content: "Launch day.",
          platforms: [{ platform: "tiktok", accountId: STAND_IN }],
        },
      }),
    ).rejects.toThrow(EvalExternalCallError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still send a real account's request, even when its text says eval:", async () => {
    await expect(
      projectComposioFetch("/api/v3.1/tools/execute/proxy", {
        method: "POST",
        jsonBody: { connected_account_id: "ca_real", text: "eval: results" },
      }),
    ).rejects.toThrow("Composio API request failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
