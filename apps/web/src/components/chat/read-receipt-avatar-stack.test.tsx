import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "summary") {
      return `Seen by ${values?.count} people`;
    }
    if (key === "readAt") {
      return `Read ${values?.time}`;
    }
    const labels: Record<string, string> = {
      open: "See who has read this",
      title: "Seen by",
      notReadTitle: "Not read yet",
    };
    return labels[key] ?? key;
  },
  useFormatter: () => ({
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));

import {
  ReadReceiptAvatarStack,
  readReceiptFacesWidth,
} from "./read-receipt-avatar-stack";

function participant(id: string, name?: string): ChatRoomUserParticipant {
  return {
    id,
    name: name ?? `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access: "member",
    lastReadAt: null,
  } as ChatRoomUserParticipant;
}

function reader(id: string, isoLastReadAt: string): RoomReader {
  return { participant: participant(id), lastReadAt: new Date(isoLastReadAt) };
}

const READERS_ABOVE_CAP: RoomReader[] = [
  reader("a", "2026-01-01T14:00:00.000Z"),
  reader("b", "2026-01-01T13:00:00.000Z"),
  reader("c", "2026-01-01T12:00:00.000Z"),
  reader("d", "2026-01-01T11:00:00.000Z"),
  reader("e", "2026-01-01T10:00:00.000Z"),
];

/**
 * The transcript reserves this width at the end of the message so the faces
 * stay on the last line. Wrong by a few pixels and the faces drop to a row of
 * their own, which is the whole thing this avoids.
 */
describe("readReceiptFacesWidth", () => {
  it("is zero when there is nobody to show", () => {
    expect(readReceiptFacesWidth(0, "sm")).toBe(0);
  });

  it("measures each overlapping face up to the cap", () => {
    // 16px faces overlapping by 4px: 16, then 12 per extra slot.
    expect(readReceiptFacesWidth(1, "sm")).toBe(16);
    expect(readReceiptFacesWidth(2, "sm")).toBe(28);
    expect(readReceiptFacesWidth(3, "sm")).toBe(40);
  });

  it("counts the +N as one more slot, and stops growing after it", () => {
    expect(readReceiptFacesWidth(4, "sm")).toBe(52);
    expect(readReceiptFacesWidth(99, "sm")).toBe(52);
  });

  it("measures the larger header faces too", () => {
    expect(readReceiptFacesWidth(1)).toBe(24);
    expect(readReceiptFacesWidth(4)).toBe(72);
  });
});

describe("ReadReceiptAvatarStack", () => {
  it("renders nothing when nobody has read the room", () => {
    const { container } = render(
      <ReadReceiptAvatarStack readers={[]} nonReaders={[participant("a")]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows three faces and a +N above the cap, most-recent-read first", () => {
    render(
      <ReadReceiptAvatarStack readers={READERS_ABOVE_CAP} nonReaders={[]} />,
    );

    const stack = screen.getByTestId("read-receipt-stack");
    expect(
      within(stack).getByTestId("read-receipt-face-a"),
    ).toBeInTheDocument();
    expect(
      within(stack).getByTestId("read-receipt-face-b"),
    ).toBeInTheDocument();
    expect(
      within(stack).getByTestId("read-receipt-face-c"),
    ).toBeInTheDocument();
    expect(
      within(stack).queryByTestId("read-receipt-face-d"),
    ).not.toBeInTheDocument();
    expect(stack).toHaveTextContent("+2");
  });

  it("shows the faces in the order it is handed, most-recent-read first", () => {
    // Ids deliberately out of alphabetical order, so sorting by anything but
    // the given order fails here. The hook sorts; the stack must not re-sort,
    // or the three faces would stop being the three the list names first.
    render(
      <ReadReceiptAvatarStack
        readers={[
          reader("zoe", "2026-01-01T14:00:00.000Z"),
          reader("adam", "2026-01-01T13:00:00.000Z"),
          reader("mina", "2026-01-01T12:00:00.000Z"),
        ]}
        nonReaders={[]}
      />,
    );

    const shown = screen
      .getAllByTestId(/^read-receipt-face-/)
      .map((face) => face.dataset.testid);

    expect(shown).toEqual([
      "read-receipt-face-zoe",
      "read-receipt-face-adam",
      "read-receipt-face-mina",
    ]);
  });

  it("shows every face and no +N at the cap", () => {
    render(
      <ReadReceiptAvatarStack
        readers={READERS_ABOVE_CAP.slice(0, 3)}
        nonReaders={[]}
      />,
    );

    expect(screen.getByTestId("read-receipt-stack")).not.toHaveTextContent("+");
  });

  it("names the count for assistive technology", () => {
    render(
      <ReadReceiptAvatarStack readers={READERS_ABOVE_CAP} nonReaders={[]} />,
    );

    expect(
      screen.getByRole("button", { name: "Seen by 5 people" }),
    ).toBeInTheDocument();
  });

  // 24px faces plus 10px a side is 44. Asserted as tokens because no test
  // environment here computes Tailwind, and the sibling sidebar row is tested
  // the same way.
  it("carries the touch target out to 44px below md", () => {
    render(
      <ReadReceiptAvatarStack readers={READERS_ABOVE_CAP} nonReaders={[]} />,
    );

    const tokens = screen
      .getByTestId("read-receipt-stack")
      .className.split(/\s+/);
    expect(tokens).toContain("after:-inset-2.5");
    expect(tokens).toContain("md:after:hidden");
  });

  it("opens the full reader list from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <ReadReceiptAvatarStack
        readers={READERS_ABOVE_CAP}
        nonReaders={[participant("z", "Zoe Never")]}
      />,
    );

    expect(screen.queryByTestId("read-receipt-list")).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByTestId("read-receipt-stack")).toHaveFocus();
    await user.keyboard("{Enter}");

    const list = await screen.findByTestId("read-receipt-list");
    // Every reader, not only the three the stack had room for.
    expect(within(list).getByText("User d")).toBeInTheDocument();
    expect(within(list).getByText("User e")).toBeInTheDocument();
  });

  it("carries each reader's last-read time and names who has not read", async () => {
    const user = userEvent.setup();
    render(
      <ReadReceiptAvatarStack
        readers={[reader("a", "2026-01-01T14:00:00.000Z")]}
        nonReaders={[participant("z", "Zoe Never")]}
      />,
    );

    await user.click(screen.getByTestId("read-receipt-stack"));

    const list = await screen.findByTestId("read-receipt-list");
    expect(
      within(list).getByText("Read 2026-01-01T14:00:00.000Z"),
    ).toBeInTheDocument();
    expect(within(list).getByText("Not read yet")).toBeInTheDocument();
    expect(within(list).getByText("Zoe Never")).toBeInTheDocument();
  });

  it("leaves out the not-read section when everyone has read", async () => {
    const user = userEvent.setup();
    render(
      <ReadReceiptAvatarStack
        readers={[reader("a", "2026-01-01T14:00:00.000Z")]}
        nonReaders={[]}
      />,
    );

    await user.click(screen.getByTestId("read-receipt-stack"));

    const list = await screen.findByTestId("read-receipt-list");
    expect(within(list).queryByText("Not read yet")).not.toBeInTheDocument();
  });
});
