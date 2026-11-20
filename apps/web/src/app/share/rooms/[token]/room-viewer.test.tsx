import type { DataRoomTreeRow, DataRoomView } from "@sokosumi/core-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  company: null,
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

function answers(questions: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => questions,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function viewerQuestion(
  id: string,
  path: string,
  mine: boolean,
  shared: boolean,
) {
  return {
    id,
    createdAt: "2026-11-17T10:00:00.000Z",
    path,
    body: `Question ${id}?`,
    answer: `Answer ${id}.`,
    answeredAt: "2026-11-17T11:00:00.000Z",
    mine,
    shared,
  };
}

describe("RoomViewer", () => {
  beforeEach(() => answers([]));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("has no Company page when the owner gave no company details", () => {
    render(<RoomViewer token="tok" room={room} />);
    expect(screen.queryByRole("button", { name: "Company.title" })).toBeNull();
  });

  it("shows the company's details, only the filled ones, and opens the formation folder", () => {
    render(
      <RoomViewer
        token="tok"
        room={{
          ...room,
          company: {
            legalName: "Sumico, Inc.",
            jurisdiction: "State of Delaware, USA",
            contactEmail: "legal@sumico.io",
            euRepresentative: {
              name: "Phil Isenmann",
              email: "phil@utxoag.com",
            },
            websites: ["www.cmo.xyz"],
            formationPath: "Legal/Formation",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Company.title" }));

    expect(screen.getByText("Sumico, Inc.")).toBeDefined();
    expect(screen.getByText("State of Delaware, USA")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "legal@sumico.io" })
        .getAttribute("href"),
    ).toBe("mailto:legal@sumico.io");
    expect(screen.getByText("Phil Isenmann")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "www.cmo.xyz" }).getAttribute("href"),
    ).toBe("https://www.cmo.xyz");
    expect(screen.queryByText("Company.vatId")).toBeNull();
    expect(screen.queryByText("Company.ukRepresentative")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /2\.1\s*Formation/ }));
    expect(
      screen.getByText("pdf /share/rooms/tok/files/id-Bylaws.pdf"),
    ).toBeDefined();
  });

  it("leaves out the formation link when the viewer cannot see that folder", () => {
    render(
      <RoomViewer
        token="tok"
        room={{
          ...room,
          company: { legalName: "Sumico, Inc.", formationPath: "Board" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Company.title" }));
    expect(screen.queryByText("Company.formation")).toBeNull();
  });

  it("lists the answers the owner shared on the Welcome page and opens their document", async () => {
    const fetchMock = answers([
      viewerQuestion("q_shared", "Legal/Formation/Bylaws.pdf", false, true),
      viewerQuestion("q_private", "Introduction/Deck.pdf", true, false),
    ]);
    render(<RoomViewer token="tok" room={room} />);

    expect(await screen.findByText("Question q_shared?")).toBeDefined();
    expect(screen.getByText("Answer q_shared.")).toBeDefined();
    expect(screen.queryByText("Question q_private?")).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/share/rooms/tok/questions");

    fireEvent.click(screen.getByRole("button", { name: /2\.1\.1/ }));
    expect(
      screen.getByText("pdf /share/rooms/tok/files/id-Bylaws.pdf"),
    ).toBeDefined();
  });

  it("marks shared answers beside a document as answered for everyone", async () => {
    answers([viewerQuestion("q_shared", "Introduction/Deck.pdf", false, true)]);
    render(<RoomViewer token="tok" room={room} />);
    fireEvent.click(
      screen.getByRole("button", { name: 'openFirst {"name":"Deck.pdf"}' }),
    );

    expect(await screen.findByText("Question q_shared?")).toBeDefined();
    expect(screen.getByText("sharedNote")).toBeDefined();
  });

  it("says while shared answers load, then nothing when there are none", async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((r) => (resolve = r))),
    );
    render(<RoomViewer token="tok" room={room} />);

    expect(screen.getByRole("status").textContent).toBe("sharedLoading");
    resolve({ ok: true, json: async () => [] });
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(""),
    );
    expect(screen.queryByText("sharedTitle")).toBeNull();
    expect(screen.queryByText("sharedFailed")).toBeNull();
  });

  it.each([
    [
      "the server refuses",
      () => Promise.resolve({ ok: false, json: async () => ({}) }),
    ],
    ["the network fails", () => Promise.reject(new TypeError("offline"))],
  ])(
    "says shared answers failed to load when %s, and tries again",
    async (_, fail) => {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(fail)
        .mockResolvedValue({
          ok: true,
          json: async () => [
            viewerQuestion("q_shared", "Introduction/Deck.pdf", false, true),
          ],
        });
      vi.stubGlobal("fetch", fetchMock);
      render(<RoomViewer token="tok" room={room} />);

      expect((await screen.findByRole("alert")).textContent).toContain(
        "sharedFailed",
      );
      fireEvent.click(screen.getByRole("button", { name: "retry" }));

      expect(await screen.findByText("Question q_shared?")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
