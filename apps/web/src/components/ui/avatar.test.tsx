import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { stubPendingImageLoad } from "@/test/stub-pending-image-load";

/**
 * SOKOSUMI-S9: Radix AvatarImage cleanup calls `setLoadingStatus("idle")`
 * during fiber deletion. That setState-on-unmount nested past React's update
 * depth limit on `/chat/rooms/:roomId` (Mobile Safari), under Activity +
 * seen-by Popover avatar stacks.
 *
 * Red when this module still wires Radix Avatar or reintroduces idle-on-unmount.
 */
describe("Avatar SOKOSUMI-S9", () => {
  it("does not set loading status to idle on image effect cleanup", () => {
    const avatarSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "avatar.tsx"),
      "utf8",
    );

    expect(avatarSource).not.toMatch(/from ["']radix-ui["']/);
    expect(avatarSource).not.toMatch(/setLoadingStatus\(\s*["']idle["']\s*\)/);
    expect(avatarSource).not.toMatch(/setStatus\(\s*["']idle["']\s*\)/);
    expect(avatarSource).not.toMatch(
      /setImageLoadingStatus\(\s*["']idle["']\s*\)/,
    );
  });

  stubPendingImageLoad();

  it("renders fallback while the image is pending", () => {
    render(
      <Avatar>
        <AvatarImage src="https://cdn.example.com/ada.png" alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Ada" })).not.toBeInTheDocument();
  });

  it("keeps fallback when src is missing", () => {
    render(
      <Avatar>
        <AvatarImage alt="Ada" />
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>,
    );

    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Ada" })).not.toBeInTheDocument();
  });

  it("unmounts many avatars without throwing", () => {
    const { unmount, rerender } = render(
      <>
        {Array.from({ length: 40 }, (_, i) => (
          <Avatar key={i}>
            <AvatarImage src={`https://cdn.example.com/${i}.png`} alt="" />
            <AvatarFallback>X</AvatarFallback>
          </Avatar>
        ))}
      </>,
    );
    for (let round = 0; round < 10; round++) {
      rerender(
        <>
          {Array.from({ length: 40 }, (_, i) => (
            <Avatar key={`${round}-${i}`}>
              <AvatarImage
                src={`https://cdn.example.com/${i}.png?r=${round}`}
                alt=""
              />
              <AvatarFallback>X</AvatarFallback>
            </Avatar>
          ))}
        </>,
      );
    }
    rerender(<></>);
    unmount();
  });
});

describe("Avatar image load", () => {
  it("renders the image once the probe reports loaded", () => {
    const complete = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "complete",
    );
    const naturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth",
    );
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 64,
    });

    try {
      render(
        <Avatar>
          <AvatarImage src="https://cdn.example.com/ada.png" alt="Ada" />
          <AvatarFallback>AD</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByRole("img", { name: "Ada" })).toHaveAttribute(
        "src",
        "https://cdn.example.com/ada.png",
      );
      // Hide fallback once loaded so transparent PNG/WebP/GIF avatars do not
      // bleed initials/icons through the photo (Radix Avatar behavior).
      expect(screen.queryByText("AD")).not.toBeInTheDocument();
    } finally {
      if (complete) {
        Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
      }
      if (naturalWidth) {
        Object.defineProperty(
          HTMLImageElement.prototype,
          "naturalWidth",
          naturalWidth,
        );
      }
    }
  });
});
