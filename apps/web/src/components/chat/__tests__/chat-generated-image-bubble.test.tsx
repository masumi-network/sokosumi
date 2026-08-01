import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { stubPendingImageLoad } from "@/test/stub-pending-image-load";

import { ChatGeneratedImageBubble } from "../chat-generated-image-bubble";

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
    if (key === "close") {
      return "Close";
    }
    return key;
  },
}));

describe("ChatGeneratedImageBubble", () => {
  stubPendingImageLoad();
  it("shows a loading skeleton while waiting for generated image data", () => {
    const { container } = render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
      />,
    );

    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).toBeInTheDocument();
  });

  it("fades in the image after it loads", () => {
    render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
        src="https://example.com/generated-image.png"
      />,
    );

    const image = screen.getByRole("img", { name: "Generated image" });
    expect(image).toHaveClass("opacity-0");

    fireEvent.load(image);

    expect(image).toHaveClass("opacity-100");
  });

  it("renders a download link for the generated image", () => {
    render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
        src="data:image/jpeg;base64,abc123=="
      />,
    );

    const link = screen.getByRole("link", {
      name: "Download generated image",
    });

    expect(link).toHaveAttribute("href", "data:image/jpeg;base64,abc123==");
    expect(link).toHaveAttribute("download", "generated-image.jpg");
  });

  it("uses the URL path extension for persisted HTTPS blob image src", () => {
    render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
        src="https://blob.example.com/uploads/generated-abc123.webp"
      />,
    );

    const image = screen.getByRole("img", { name: "Generated image" });
    fireEvent.load(image);

    const link = screen.getByRole("link", {
      name: "Download generated image",
    });

    expect(link).toHaveAttribute("download", "generated-image.webp");
  });

  it("uses svg extension for HTTPS URLs ending in .svg", () => {
    render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
        src="https://blob.example.com/path/generated-hash.svg"
      />,
    );

    const image = screen.getByRole("img", { name: "Generated image" });
    fireEvent.load(image);

    const link = screen.getByRole("link", {
      name: "Download generated image",
    });

    expect(link).toHaveAttribute("download", "generated-image.svg");
  });

  it("opens an image viewer when the loaded image is activated", () => {
    render(
      <ChatGeneratedImageBubble
        alt="Generated image"
        downloadLabel="Download generated image"
        src="https://example.com/generated-image.png"
      />,
    );

    const image = screen.getByRole("img", { name: "Generated image" });
    fireEvent.load(image);

    fireEvent.click(
      screen.getByRole("button", { name: "View image Generated image" }),
    );

    const viewer = screen.getByTestId("image-viewer");
    expect(viewer).toBeInTheDocument();
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/generated-image.png",
    );
  });
});
