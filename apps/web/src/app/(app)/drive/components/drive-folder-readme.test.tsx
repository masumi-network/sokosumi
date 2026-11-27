import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DriveFilePreviewTextState } from "@/hooks/effects/use-drive-file-preview-text";

let textState: DriveFilePreviewTextState = { kind: "loading" };
const readSources: string[] = [];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/hooks/effects/use-drive-file-preview-text", () => ({
  useDriveFilePreviewText: (_isText: boolean, source: string) => {
    readSources.push(source);
    return textState;
  },
}));

const { DriveFolderReadme, findFolderReadme, isLongReadme } = await import(
  "./drive-folder-readme"
);

const file = (displayName: string, sizeBytes: number | null = 100) => ({
  id: `id-${displayName}`,
  displayName,
  mimeType: null,
  sizeBytes,
});

describe("findFolderReadme", () => {
  it("finds README.md in any case", () => {
    expect(
      findFolderReadme([file("notes.md"), file("ReadMe.MD")])?.displayName,
    ).toBe("ReadMe.MD");
  });

  it("ignores other names and READMEs too big to preview", () => {
    expect(findFolderReadme([file("README.txt"), file("readme")])).toBeNull();
    expect(findFolderReadme([file("README.md", 600 * 1024)])).toBeNull();
  });

  it("accepts a README whose size is unknown", () => {
    expect(findFolderReadme([file("README.md", null)])).not.toBeNull();
  });
});

describe("isLongReadme", () => {
  it("clamps only long text", () => {
    expect(isLongReadme("# Contracts\nSigned ones go in /signed.")).toBe(false);
    expect(isLongReadme("line\n".repeat(20))).toBe(true);
    expect(isLongReadme("x".repeat(700))).toBe(true);
  });
});

describe("DriveFolderReadme", () => {
  beforeEach(() => {
    readSources.length = 0;
  });

  const renderCard = (onOpen = vi.fn()) =>
    render(
      <DriveFolderReadme
        file={file("README.md")}
        store={{ scope: "org", organizationId: "org-1" }}
        onOpen={onOpen}
      />,
    );

  it("renders nothing while loading or when the file cannot load", () => {
    textState = { kind: "loading" };
    const { container, rerender } = renderCard();
    expect(container).toBeEmptyDOMElement();

    textState = { kind: "failed" };
    rerender(
      <DriveFolderReadme
        file={file("README.md")}
        store={{ scope: "org", organizationId: "org-1" }}
        onOpen={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the README through the authorized content route", () => {
    textState = { kind: "loading" };
    renderCard();
    expect(readSources[0]).toBe(
      "/api/drive/files/id-README.md/content?scope=org&organizationId=org-1",
    );
  });

  it("shows the README with Open, and no Show more for short text", () => {
    textState = { kind: "ready", text: "Signed contracts go in /signed." };
    const onOpen = vi.fn();
    renderCard(onOpen);

    expect(
      screen.getByRole("region", { name: "readmeLabel" }),
    ).toHaveTextContent("Signed contracts go in /signed.");
    expect(screen.queryByText("readmeShowMore")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "previewOpen" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("clamps long text and expands it on Show more", () => {
    textState = { kind: "ready", text: "line\n".repeat(20) };
    renderCard();

    const toggle = screen.getByRole("button", { name: "readmeShowMore" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "readmeShowLess" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
