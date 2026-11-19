import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContactLinkWorkspaceProvider } from "@/app/contacts/components/contact-link-workspace";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { contactMentionTarget } from "@/components/contact-mention-target";
import { RoomMessageMarkdown } from "./room-mention-markdown";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { get: read },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const id = "01960001-aab1-7001-8001-000000000001";
const workspace = "01960001-aab1-7001-8001-000000000002";
const otherWorkspace = "01960001-0001-7001-8001-000000000003";
const href = `/contacts?contact=${id}&workspace=${workspace}`;
const content = `Meet [Avery](${href}).`;

function message(text: string, interactive = true) {
  return (
    <RoomMessageMarkdown
      content={text}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      hoverInteractive={interactive}
    />
  );
}

function surface(children: ReactNode, client: QueryClient, active = workspace) {
  return (
    <QueryClientProvider client={client}>
      <ContactLinkWorkspaceProvider
        workspaceId={active}
        available={[workspace, otherWorkspace]}
      >
        {children}
      </ContactLinkWorkspaceProvider>
    </QueryClientProvider>
  );
}

describe("contact mentions", () => {
  it("recognizes contact links in browsers without URL.parse or URLSearchParams.size", () => {
    const parse = vi.spyOn(URL, "parse").mockImplementation(() => {
      throw new Error("URL.parse unavailable");
    });
    const size = vi
      .spyOn(URLSearchParams.prototype, "size", "get")
      .mockImplementation(() => {
        throw new Error("URLSearchParams.size unavailable");
      });
    try {
      expect(contactMentionTarget(href)).toEqual({
        id,
        workspaceId: workspace,
        origin: null,
      });
      expect(contactMentionTarget("https://example.test/")).toBeNull();
    } finally {
      parse.mockRestore();
      size.mockRestore();
    }
  });

  it.each(["chat", "Task description"])(
    "opens the verified contact in place from a %s, with an optional full record",
    async (where) => {
      read.mockReset().mockResolvedValue({
        id,
        name: "Avery Jones",
        channels: [
          { type: "EMAIL", value: "avery@example.test", isPrimary: true },
        ],
        role: "Designer",
        organization: "Example Studio",
      });
      const user = userEvent.setup();
      render(
        surface(
          where === "chat" ? (
            message(content)
          ) : (
            <TaskDescription title="Description" description={content} />
          ),
          new QueryClient(),
        ),
      );
      expect(read).not.toHaveBeenCalled();
      const trigger = screen.getByRole("button", { name: "Avery" });
      trigger.focus();
      await user.keyboard("{Enter}");
      const card = await screen.findByRole("dialog");
      expect(await within(card).findByText("Avery Jones")).toBeVisible();
      expect(within(card).getByText("avery@example.test")).toBeVisible();
      expect(within(card).getByText(/Designer/)).toBeVisible();
      expect(within(card).getByText(/Example Studio/)).toBeVisible();
      expect(within(card).getByRole("link")).toHaveAttribute("href", href);
      expect(read).toHaveBeenCalledWith(id);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );

  it("previews on mouse hover without moving focus and keeps the card open after choosing the name", async () => {
    read
      .mockReset()
      .mockResolvedValue({ id, name: "Avery Jones", channels: [] });
    const user = userEvent.setup();
    render(
      surface(
        <>
          <button type="button">Composer</button>
          {message(content)}
        </>,
        new QueryClient(),
      ),
    );
    const composer = screen.getByRole("button", { name: "Composer" });
    composer.focus();
    const trigger = screen.getByRole("button", { name: "Avery" });
    await user.hover(trigger);
    expect(await screen.findByText("Avery Jones")).toBeVisible();
    expect(composer).toHaveFocus();
    await user.click(trigger);
    await user.unhover(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the open record after a workspace switch, even with a cached result", async () => {
    read.mockReset().mockResolvedValue({
      id,
      name: "Private record",
      channels: [],
      organization: "Private studio",
    });
    const client = new QueryClient();
    const user = userEvent.setup();
    const { rerender } = render(surface(message(content), client));
    await user.click(screen.getByRole("button", { name: "Avery" }));
    expect(await screen.findByText("Private studio")).toBeVisible();
    rerender(surface(message(content), client, otherWorkspace));
    expect(screen.queryByText("Private studio")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Avery" });
    if (!screen.queryByRole("dialog")) await user.click(trigger);
    expect(
      within(screen.getByRole("dialog")).getByRole("link"),
    ).toHaveAttribute("href", href);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("opens a same-origin legacy contact link by touch in the current workspace", async () => {
    read
      .mockReset()
      .mockResolvedValue({ id, name: "Avery Jones", channels: [] });
    const user = userEvent.setup();
    render(
      surface(
        message(`[Avery](${window.location.origin}/contacts?contact=${id})`),
        new QueryClient(),
      ),
    );
    const trigger = screen.getByRole("button", { name: "Avery" });
    await user.pointer([
      { keys: "[TouchA>]", target: trigger },
      { keys: "[/TouchA]" },
    ]);
    expect(await screen.findByText("Avery Jones")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByRole("link"),
    ).toHaveAttribute("href", href);
  });

  it("shows no contact or navigation for an inaccessible source workspace", async () => {
    read.mockReset();
    render(
      surface(
        message(
          content.replace(workspace, "01960001-0001-7001-8001-000000000004"),
        ),
        new QueryClient(),
      ),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Avery" }));
    const card = screen.getByRole("dialog");
    expect(within(card).getByRole("status")).toHaveTextContent("unavailable");
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a failed lookup in the card without showing stale details", async () => {
    read.mockReset().mockRejectedValue(new Error("Contact no longer exists"));
    render(surface(message(content), new QueryClient()));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Avery" }));
    expect(await screen.findByText("unavailable")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).queryByRole("link"),
    ).not.toBeInTheDocument();
  });

  it("looks up the same active workspace and contact for upper-case UUIDs", async () => {
    read
      .mockReset()
      .mockResolvedValue({ id, name: "Verified record", channels: [] });
    const caps = href
      .replace(id, id.toUpperCase())
      .replace(workspace, workspace.toUpperCase());
    render(surface(message(`[Avery](${caps})`), new QueryClient()));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Avery" }));
    expect(await screen.findByText("Verified record")).toBeVisible();
    expect(read).toHaveBeenCalledWith(id);
  });

  it("offers a merged record's successor without showing the old identity", async () => {
    const survivor = "01960001-0001-7001-8001-000000000005";
    read.mockReset().mockResolvedValue({
      id,
      name: "Obsolete record",
      channels: [],
      mergedIntoId: survivor,
    });
    render(surface(message(content), new QueryClient()));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Avery" }));
    const card = screen.getByRole("dialog");
    expect(await within(card).findByRole("link")).toHaveAttribute(
      "href",
      href.replace(id, survivor),
    );
    expect(within(card).getByRole("status")).toHaveTextContent("merged");
    expect(within(card).queryByText("Obsolete record")).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("leaves external URLs and malformed references as ordinary links and quoted names as text", () => {
    read.mockReset();
    render(
      surface(
        <>
          {message(
            `[Elsewhere](https://somewhere.example${href}) [Bad ID](/contacts?contact=nope)`,
          )}
          {message(content, false)}
        </>,
        new QueryClient(),
      ),
    );
    expect(screen.getByRole("link", { name: "Elsewhere" })).toHaveAttribute(
      "href",
      `https://somewhere.example${href}`,
    );
    expect(screen.getByRole("link", { name: "Bad ID" })).toHaveAttribute(
      "href",
      "/contacts?contact=nope",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Avery" }),
    ).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
});
