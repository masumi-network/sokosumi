import { renderAvatarSvg, validateAvatar } from "open-bot-avatar";
import { describe, expect, it } from "vitest";

import { CUSO_POINTER } from "./cuso-pointer-avatar";

describe("CUSO_POINTER", () => {
  it("passes the open-bot-avatar contract", () => {
    const result = validateAvatar(CUSO_POINTER);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("renders a still SVG", () => {
    const svg = renderAvatarSvg(CUSO_POINTER, { size: 96 });
    expect(svg).toMatch(/^<svg/);
  });

  it("rejects a definition with eyes outside the body", () => {
    const result = validateAvatar({
      ...CUSO_POINTER,
      eyes: { ...CUSO_POINTER.eyes, x: 90, y: 10 },
    });
    expect(result.ok).toBe(false);
  });
});
