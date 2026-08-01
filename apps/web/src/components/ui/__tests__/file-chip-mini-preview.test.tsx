import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileChipMiniPreview } from "../file-chip-mini-preview";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
  }: {
    alt: string;
    src: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "viewImage") {
      return `View image ${values?.fileName ?? ""}`;
    }
    if (key === "title") {
      return "Image";
    }
    if (key === "download") {
      return "Download image";
    }
    return key;
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("FileChipMiniPreview", () => {
  it("opens an image viewer instead of navigating away for image files", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
        mediaType="image/png"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /photo\.png/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View image photo.png" }));

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download image" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/photo.png");
  });

  it("keeps a download/open link for non-image files", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/notes.pdf",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });
});
