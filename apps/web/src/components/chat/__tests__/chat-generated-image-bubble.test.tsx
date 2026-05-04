import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatGeneratedImageBubble } from "../chat-generated-image-bubble";

describe("ChatGeneratedImageBubble", () => {
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
        src="data:image/png;base64,abc123=="
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
});
