import type { DataRoomTreeRow, DataRoomView } from "@sokosumi/core-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./room-mark", () => ({ RoomMark: () => null }));
vi.mock("./room-pdf", () => ({
  RoomPdf: ({ url }: { url: string }) => <p>pdf {url}</p>,
}));

import { RoomViewer } from "./room-viewer";

function row(
  kind: "folder" | "file",
  path: string,
  number: string,
): DataRoomTreeRow {
  const name = path.split("/").at(-1) ?? path;
  return {
    kind,
    path,
    name,
    depth: path.split("/").length - 1,
    number,
    resourceId: kind === "file" ? `id-${name}` : null,
    sizeBytes: kind === "file" ? 1 : null,
    mimeType: kind === "file" ? "application/pdf" : null,
    updatedAt: null,
  };
}

const room: DataRoomView = {
  state: "in",
  title: "Seed Round 2026",
  welcomeNote: "Thanks for looking.\nStart with the deck.",
  hasLogo: false,
  allowDownload: true,
  watermark: false,
  viewer: { email: "investor@example.com", name: null },
  rows: [
    row("folder", "Introduction", "1"),
    row("file", "Introduction/Deck.pdf", "1.1"),
    row("folder", "Legal", "2"),
    row("folder", "Legal/Formation", "2.1"),
    row("file", "Legal/Formation/Bylaws.pdf", "2.1.1"),
  ],
};

describe("RoomViewer", () => {
  afterEach(cleanup);

  it("opens on the Welcome page with the note and a download of everything", () => {
    render(<RoomViewer token="tok" room={room} />);

    expect(screen.getByText(/Thanks for looking/)).toBeDefined();
    expect(screen.getByText('contents {"files":2,"folders":3}')).toBeDefined();
    expect(
      screen.getByRole("link", { name: "downloadAll" }).getAttribute("href"),
    ).toBe("/share/rooms/tok/zip");
  });

  it("keeps the download off the Welcome page when the room has downloads off", () => {
    render(<RoomViewer token="tok" room={{ ...room, allowDownload: false }} />);
    expect(screen.queryByRole("link", { name: "downloadAll" })).toBeNull();
  });

  it("shows folders closed and opens them one level at a time", () => {
    render(<RoomViewer token="tok" room={room} />);
    expect(screen.queryByText("Formation")).toBeNull();

    const legal = screen.getByRole("button", { name: /Legal/ });
    expect(legal.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(legal);
    expect(legal.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Formation")).toBeDefined();
    expect(screen.queryByText("Bylaws.pdf")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Formation/ }));
    expect(screen.getByText("Bylaws.pdf")).toBeDefined();
  });

  it("opens the first document from the Welcome page, folders around it expanded", () => {
    render(<RoomViewer token="tok" room={room} />);

    fireEvent.click(
      screen.getByRole("button", { name: 'openFirst {"name":"Deck.pdf"}' }),
    );

    expect(
      screen.getByText("pdf /share/rooms/tok/files/id-Deck.pdf"),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: /Introduction/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
