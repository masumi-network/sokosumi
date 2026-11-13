import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createOrganizationChatList,
  declineInvitationMock,
  listPendingMock,
  makeInvitation,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const partners = makeInvitation({ id: "inv-1", roomName: "Partners" });
const vendors = makeInvitation({ id: "inv-2", roomName: "Vendors" });
const press = makeInvitation({ id: "inv-3", roomName: "Press" });

/** A decline that stays open until the test answers or rejects it. */
function holdOpen() {
  let answer: (value: unknown) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  declineInvitationMock.mockReturnValueOnce(
    new Promise((resolve, fail) => {
      answer = resolve;
      reject = fail;
    }),
  );
  return {
    answer: (value: unknown) => act(async () => answer(value)),
    reject: () => act(async () => reject(new Error("network down"))),
  };
}

/** The list also reads the invitations itself once it mounts. */
async function renderPending(invitations: (typeof partners)[]) {
  listPendingMock.mockResolvedValue({ ok: true, value: invitations });
  const view = renderOrganizationChatList({ pendingInvitations: invitations });
  await screen.findAllByRole("button", {
    name: "App.Channels.External.decline",
  });
  // Let that first read land before the test starts a write.
  await act(async () => {});
  return view;
}

const declineButtons = () =>
  screen.getAllByRole("button", { name: "App.Channels.External.decline" });

/** The pending invitations on screen, top to bottom. */
const shownInvitations = () =>
  ["Partners", "Vendors", "Press"]
    .filter((name) => screen.queryByText(name))
    .toSorted((a, b) =>
      screen.getByText(a).compareDocumentPosition(screen.getByText(b)) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );

describe("OrganizationChatList decline invitation", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  it("takes the invitation off the list before Core answers and keeps it off", async () => {
    const write = holdOpen();
    await renderPending([partners, vendors]);

    fireEvent.click(declineButtons()[0]);
    expect(shownInvitations()).toEqual(["Vendors"]);
    expect(declineInvitationMock).toHaveBeenCalledExactlyOnceWith("inv-1");

    await write.answer({ ok: true, value: partners });
    expect(shownInvitations()).toEqual(["Vendors"]);
  });

  it("drops an invitation that a list read brought back while Core declined it", async () => {
    const write = holdOpen();
    const { rerender } = await renderPending([partners, vendors]);

    fireEvent.click(declineButtons()[0]);
    // A page render that read Core before the decline landed.
    rerender(
      createOrganizationChatList({ pendingInvitations: [partners, vendors] }),
    );
    expect(shownInvitations()).toEqual(["Partners", "Vendors"]);

    await write.answer({ ok: true, value: partners });
    expect(shownInvitations()).toEqual(["Vendors"]);
  });

  it.each([
    [
      "Core refuses",
      (write: ReturnType<typeof holdOpen>) =>
        write.answer({ ok: false, error: { message: "Core is down" } }),
    ],
    ["the call fails", (write: ReturnType<typeof holdOpen>) => write.reject()],
  ])("puts the invitation back in its place when %s", async (_case, settle) => {
    const write = holdOpen();
    await renderPending([partners, vendors, press]);

    fireEvent.click(declineButtons()[1]);
    expect(shownInvitations()).toEqual(["Partners", "Press"]);

    await settle(write);
    expect(shownInvitations()).toEqual(["Partners", "Vendors", "Press"]);
    // The answer buttons work again.
    expect(declineButtons()[0]).toBeEnabled();
  });
});
