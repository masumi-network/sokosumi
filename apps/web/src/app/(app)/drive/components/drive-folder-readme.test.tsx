import type { FileResource } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFolderReadme } = vi.hoisted(() => ({
  fetchFolderReadme: vi.fn(),
}));

vi.mock("@/lib/utils/file-search.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/file-search.client")>()),
  fetchFolderReadme,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${values.name}` : key,
}));

import { DriveFolderReadme } from "./drive-folder-readme";

const README_FILE = {
  id: "res_readme",
  displayName: "README.md",
  mimeType: "text/markdown",
  sizeBytes: 100,
  pathname: "drive/orgs/org-1/Client work/README.md",
} as unknown as FileResource;

const LONG_README = [
  "# Client work",
  "",
  "Everything for client projects lives here.",
  "",
  "## Where things go",
  "",
  ...Array.from({ length: 14 }, (_, i) => `- Rule ${i + 1}`),
  "",
  "See the [team handbook](https://handbook.example/rules).",
].join("\n");

function renderCard(text: string, onOpen = vi.fn()) {
  fetchFolderReadme.mockResolvedValue(README_FILE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DriveFolderReadme
        store={{ scope: "org", organizationId: "org-1" }}
        folder="Client work"
        onOpen={onOpen}
      />
    </QueryClientProvider>,
  );
  return onOpen;
}

describe("DriveFolderReadme", () => {
  beforeEach(() => {
    fetchFolderReadme.mockReset();
  });

  it("looks the README up for the browsed folder and reads it through the authorized route", async () => {
    renderCard("Signed contracts go in /signed.");

    expect(
      await screen.findByRole("region", { name: "readmeLabel" }),
    ).toHaveTextContent("Signed contracts go in /signed.");
    expect(fetchFolderReadme).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "Client work" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/drive/files/res_readme/content?scope=org&organizationId=org-1",
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: "readmeShowMore" })).toBeNull();
  });

  it("renders nothing when the folder has no README", async () => {
    fetchFolderReadme.mockResolvedValue(null);
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <DriveFolderReadme store={{ scope: "me" }} folder="" onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(fetchFolderReadme).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the README file in the viewer", async () => {
    const onOpen = renderCard("Short.");
    await userEvent.click(
      await screen.findByRole("button", { name: "previewOpen" }),
    );
    expect(onOpen).toHaveBeenCalledWith(README_FILE);
  });

  it("keeps a link below the excerpt out of the tab order until Show more", async () => {
    const user = userEvent.setup();
    renderCard(LONG_README);

    const more = await screen.findByRole("button", { name: "readmeShowMore" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "team handbook" })).toBeNull();

    // Tab from Open goes straight to Show more: nothing hidden in between.
    screen.getByRole("button", { name: "previewOpen" }).focus();
    await user.tab();
    expect(more).toHaveFocus();

    await user.click(more);
    expect(screen.getByRole("link", { name: "team handbook" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "readmeShowLess" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("never cuts the excerpt inside a code fence", async () => {
    renderCard(
      [
        "Intro.",
        "",
        "```",
        ...Array.from({ length: 20 }, (_, i) => `line ${i}`),
        "```",
      ].join("\n"),
    );
    const card = await screen.findByRole("region", { name: "readmeLabel" });
    expect(card).toHaveTextContent("Intro.");
    expect(card).not.toHaveTextContent("line 0");
  });

  it("turns images and media into links instead of loading them", async () => {
    renderCard(
      [
        "![Team logo](https://media.example/logo.png)",
        "",
        '<video src="https://media.example/intro.mp4"></video>',
        "",
        '<audio src="https://media.example/hello.mp3"></audio>',
      ].join("\n"),
    );
    const card = await screen.findByRole("region", { name: "readmeLabel" });

    expect(card.querySelector("img, video, audio, source")).toBeNull();
    expect(
      screen.getByRole("link", { name: "readmeMediaNamed:Team logo" }),
    ).toHaveAttribute("href", "https://media.example/logo.png");
    expect(screen.getAllByRole("link", { name: "readmeMedia" })).toHaveLength(
      2,
    );
  });

  it("puts README headings under the card's own heading", async () => {
    renderCard("# Client work\n\n## Naming\n\nText.");
    await screen.findByRole("region", { name: "readmeLabel" });

    expect(
      screen.getByRole("heading", { name: "README.md", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Client work", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Naming", level: 4 }),
    ).toBeInTheDocument();
  });
});
