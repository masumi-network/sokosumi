import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BotFace } from "./bot-face";

describe("BotFace", () => {
  it("shows the bot's Soko Bot avatar, at the size its caller asks for", () => {
    render(
      <BotFace
        imageUrl="https://blob/avatar.webp"
        seed="seed-1"
        alt="Writer"
        className="size-10"
      />,
    );

    const face = screen.getByRole("img", { name: "Writer" });
    expect(face).toHaveAttribute("src", "https://blob/avatar.webp");
    expect(face.className).toContain("size-10");
  });

  it("draws the bot's orb when it has no avatar", async () => {
    render(<BotFace imageUrl={null} seed="seed-1" alt="Writer" />);

    const orb = await screen.findByRole("img", { name: "Writer" });
    expect(orb.getAttribute("src") ?? "").not.toMatch(/^https:/);
    expect(document.querySelector('img[src^="https://"]')).toBeNull();
  });
});
