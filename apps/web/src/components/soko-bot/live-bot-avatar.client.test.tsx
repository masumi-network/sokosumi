import { formatAvatarCode, originalAvatarLook } from "@sokosumi/soko-bot";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveBotAvatar from "./live-bot-avatar.client";

const code = formatAvatarCode(originalAvatarLook("fox"));

afterEach(() => vi.restoreAllMocks());

describe("LiveBotAvatar", () => {
  it("stays the still picture when WebGL is unavailable", () => {
    // No WebGL context: the renderer cannot start.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(
      <LiveBotAvatar
        code={code}
        state="idle"
        size={64}
        imageUrl="https://blob.test/fox.png"
        alt="Atlas"
      />,
    );
    expect(screen.getByRole("img", { name: "Atlas" })).toHaveAttribute(
      "src",
      "https://blob.test/fox.png",
    );
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("draws the avatar's own picture when no image is given", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<LiveBotAvatar code={code} state="idle" size={64} alt="Atlas" />);
    expect(
      screen.getByRole("img", { name: "Atlas" }).getAttribute("src"),
    ).toMatch(/^data:image\/svg\+xml/);
  });

  it("shows only the picture for a code it cannot read", () => {
    const { container } = render(
      <LiveBotAvatar
        code="nonsense"
        state="idle"
        size={64}
        imageUrl="https://blob.test/x.png"
        alt="Atlas"
      />,
    );
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByRole("img", { name: "Atlas" })).toBeTruthy();
  });
});
