import {
  type CallToolResult,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCIAL } from "../../../harness/fixtures.ts";
import { Shell } from "../../shell/Shell.tsx";
import {
  isEmpty,
  SOCIAL_EMPTY,
  SocialPosts,
  SocialPostsList,
} from "./SocialPosts.tsx";

type Answer = (name: string) => Promise<CallToolResult>;

const BASE = "https://app.sokosumi.com";
const launch = SOCIAL.posts[0].post;

/** A fake host and what the view sent it. `serverTools: false` offers no tool calls. */
async function openPosts(
  result: CallToolResult,
  {
    answer = async () => SOCIAL.canceled,
    serverTools = true,
    input = SOCIAL.input,
  }: {
    answer?: Answer;
    serverTools?: boolean;
    input?: Record<string, unknown>;
  } = {},
) {
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    {
      openLinks: {},
      updateModelContext: { text: {} },
      ...(serverTools && { serverTools: {} }),
    },
    { hostContext: { locale: "en-US", timeZone: "UTC" } },
  );
  const sent = { links: vi.fn(), calls: vi.fn(), context: vi.fn() };
  bridge.onopenlink = async ({ url }) => {
    sent.links(url);
    return {};
  };
  bridge.oncalltool = async ({ name, arguments: args }) => {
    sent.calls(name, args);
    return answer(name);
  };
  bridge.onupdatemodelcontext = async ({ content }) => {
    sent.context(content);
    return {};
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(hostSide);

  const app = new App(
    { name: "test-view", version: "1.0.0" },
    {},
    { autoResize: false },
  );
  render(
    <Shell
      app={app}
      transport={viewSide}
      schema={SocialPostsList}
      isEmpty={isEmpty}
      empty={SOCIAL_EMPTY}
      refreshTool="workspaces_social_posts"
    >
      {(data, context) => <SocialPosts data={data} context={context} />}
    </Shell>,
  );
  await act(() => initialized);
  await act(() => bridge.sendToolInput({ arguments: input }));
  await act(() => bridge.sendToolResult(result));
  return sent;
}

const postItems = () =>
  within(screen.getByRole("list", { name: "Posts to review" })).getAllByRole(
    "listitem",
  );
const click = (element: HTMLElement) =>
  act(async () => fireEvent.click(element));
const button = (name: string | RegExp, scope: HTMLElement = document.body) =>
  within(scope).getByRole("button", { name });

afterEach(cleanup);

describe("SocialPosts list", () => {
  it("shows only the posts that need approval, with their text, account, Project and schedule", async () => {
    await openPosts(SOCIAL.result);

    expect(screen.getByRole("heading", { level: 1, name: "Posts to review" }));
    expect(screen.getByText("3 need approval")).toBeTruthy();
    expect(postItems()).toHaveLength(3);
    expect(
      screen.getByText(/^Autumn pricing is live: every plan now includes/),
    ).toBeTruthy();
    expect(
      screen.queryByText("Already approved, so the view leaves it out."),
    ).toBeNull();

    const [first, second, third] = postItems();
    expect(within(first).getByText("Acme Studio · LinkedIn · Autumn launch"));
    expect(within(first).getByText("Scheduled for Nov 27, 2026, 8:30 AM"));
    expect(within(second).getByText("@acme · X · Autumn launch"));
    expect(within(second).getByText("Media attached")).toBeTruthy();
    expect(within(second).getByText("3 posts in the thread")).toBeTruthy();
    expect(within(third).getByText("No time set"));
  });

  it("renders post text as text, and no media", async () => {
    await openPosts(SOCIAL.result);

    expect(screen.getByText(/<b>Markup stays text\.<\/b>/)).toBeTruthy();
    expect(document.querySelector("main b")).toBeNull();
    expect(document.querySelector("img, video, picture")).toBeNull();
  });

  it("shows the empty state when nothing needs approval", async () => {
    await openPosts(SOCIAL.none);

    expect(screen.getByText("Nothing needs approval")).toBeTruthy();
  });

  it("says how many wait when Core holds more than one page", async () => {
    await openPosts(SOCIAL.paged);

    expect(
      screen.getByText("Showing 3 of 35. Review the rest in Sokosumi."),
    ).toBeTruthy();
  });

  it("never calls an unfiltered page empty while older posts remain", async () => {
    await openPosts(SOCIAL.unfiltered, { input: { workspace: "acme" } });

    expect(screen.queryByText("Nothing needs approval")).toBeNull();
    expect(screen.getByText("0 need approval")).toBeTruthy();
    expect(
      screen.getByText(
        "Only the newest posts were checked. Others may wait in Sokosumi.",
      ),
    ).toBeTruthy();
  });

  it("has no approve, reject or publish control (ADR 0077)", async () => {
    await openPosts(SOCIAL.result);
    await click(button("Cancel", postItems()[0]));

    const names = screen
      .getAllByRole("button")
      .map((element) => element.textContent ?? "");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/approv|reject|publish|post now|send/i);
    }
  });
});

describe("SocialPosts review link", () => {
  it("opens the post in Sokosumi's Social page, under webBaseUrl", async () => {
    const sent = await openPosts(SOCIAL.result);

    await click(button("Review in Sokosumi", postItems()[0]));

    expect(sent.links).toHaveBeenCalledWith(
      `${BASE}/social?projectId=${launch.projectId}&postId=${launch.id}`,
    );
    for (const [url] of sent.links.mock.calls) {
      expect(String(url).startsWith(`${BASE}/`)).toBe(true);
    }
  });

  it("offers no link without a webBaseUrl", async () => {
    const { _meta, ...withoutMeta } = SOCIAL.result;
    await openPosts(withoutMeta);

    expect(
      screen.queryByRole("button", { name: "Review in Sokosumi" }),
    ).toBeNull();
  });
});

describe("SocialPosts cancel", () => {
  it("cancels only after the view's own confirm", async () => {
    const sent = await openPosts(SOCIAL.result);
    const [first] = postItems();

    await click(button("Cancel", first));
    expect(sent.calls).not.toHaveBeenCalled();
    expect(within(first).getByText("Cancel this post? It won't publish."));

    await click(button("Keep", first));
    expect(sent.calls).not.toHaveBeenCalled();

    await click(button("Cancel", first));
    await click(button("Cancel post", first));

    expect(sent.calls).toHaveBeenCalledTimes(1);
    expect(sent.calls).toHaveBeenCalledWith("projects_social_post_cancel", {
      id: launch.projectId,
      postId: launch.id,
      workspace: "acme",
      body: { revision: launch.revision },
    });
    expect(within(first).getByText("Canceled. It won't publish.")).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("2 need approval")).toBeTruthy();
    expect(sent.context).toHaveBeenCalledWith([
      {
        type: "text",
        text: `The person canceled these Social posts in the view: ${launch.id}.`,
      },
    ]);
  });

  it("tells the model about every post canceled here", async () => {
    const thread = SOCIAL.posts[1].post;
    const sent = await openPosts(SOCIAL.result);

    for (const index of [0, 1]) {
      await click(button("Cancel", postItems()[index]));
      await click(button("Cancel post", postItems()[index]));
    }

    expect(sent.context).toHaveBeenLastCalledWith([
      {
        type: "text",
        text: `The person canceled these Social posts in the view: ${launch.id}, ${thread.id}.`,
      },
    ]);
  });

  it("asks for one post at a time", async () => {
    await openPosts(SOCIAL.result);
    const [first, second] = postItems();

    await click(button("Cancel", first));
    await click(button("Cancel", second));

    expect(screen.getAllByRole("button", { name: "Cancel post" })).toHaveLength(
      1,
    );
    expect(within(second).getByRole("button", { name: "Cancel post" }));
  });

  it("shows the new status after a refresh", async () => {
    let canceled = false;
    const sent = await openPosts(SOCIAL.result, {
      answer: async (name) => {
        if (name === "projects_social_post_cancel") {
          canceled = true;
          return SOCIAL.canceled;
        }
        return canceled ? SOCIAL.afterCancel : SOCIAL.result;
      },
    });

    await click(button("Cancel", postItems()[0]));
    await click(button("Cancel post", postItems()[0]));
    await click(button("Refresh"));

    expect(sent.calls).toHaveBeenLastCalledWith(
      "workspaces_social_posts",
      SOCIAL.input,
    );
    expect(screen.getByText("2 need approval")).toBeTruthy();
    expect(postItems()).toHaveLength(2);
    expect(screen.queryByText(/^Autumn pricing is live/)).toBeNull();
  });

  it("offers no Cancel on a CMO Project's post, which only CMO changes", async () => {
    await openPosts(SOCIAL.result);
    const third = postItems()[2];

    expect(within(third).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(third).getByText("Managed by CMO. Review it in Sokosumi."));
  });

  it("offers no Cancel or Refresh when the host cannot call tools", async () => {
    await openPosts(SOCIAL.result, { serverTools: false });

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Review in Sokosumi" }));
  });

  it("says when the post changed since it was read", async () => {
    await openPosts(SOCIAL.result, { answer: async () => SOCIAL.conflict });

    await click(button("Cancel", postItems()[0]));
    await click(button("Cancel post", postItems()[0]));

    expect(
      within(postItems()[0]).getByText(
        "This post changed. Refresh to see it, then try again.",
      ),
    ).toBeTruthy();
    expect(
      within(postItems()[0]).queryByRole("button", { name: "Cancel" }),
    ).toBeNull();
  });

  it("names the toolset when the cancel tool is off", async () => {
    await openPosts(SOCIAL.result, {
      answer: async () => SOCIAL.missingToolset,
    });

    await click(button("Cancel", postItems()[0]));
    await click(button("Cancel post", postItems()[0]));

    const first = postItems()[0];
    expect(
      within(first).getByText("Turn on the social toolset to cancel here"),
    );
    expect(
      within(first).getByText("?toolsets=workspaces,tasks,coworkers,social"),
    );
  });

  it("never sends a second cancel when the call may have reached Core", async () => {
    const sent = await openPosts(SOCIAL.result, {
      answer: async () => {
        throw new Error("connection lost");
      },
    });

    await click(button("Cancel", postItems()[0]));
    await click(button("Cancel post", postItems()[0]));

    const first = postItems()[0];
    expect(
      within(first).getByText(
        "Could not confirm the cancel. Refresh to check.",
      ),
    ).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(sent.calls).toHaveBeenCalledTimes(1);
  });
});
