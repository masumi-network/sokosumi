import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type StatusTone } from "./status-badge";

const css = readFileSync("src/app/globals.css", "utf8");

function luminance(theme: string, token: string): number {
  const match = theme.match(new RegExp(`--${token}: hsla\\(([^)]+)\\)`));
  if (!match) throw new Error(`Missing token: ${token}`);
  const [hue, saturation, lightness, alpha] = match[1]
    .replaceAll("%", "")
    .split(",")
    .map(Number);
  expect(alpha).toBe(1);
  const light = lightness / 100;
  const amplitude = (saturation / 100) * Math.min(light, 1 - light);
  const channels = [0, 8, 4].map((offset) => {
    const k = (offset + hue / 30) % 12;
    const channel = light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

const tones: StatusTone[] = [
  "working",
  "success",
  "warning",
  "danger",
  "accent",
];

describe("StatusBadge label contrast", () => {
  for (const selector of [":root", ".dark"]) {
    it.each(tones)(`${selector} %s label clears 4.5:1 on its fill`, (tone) => {
      const theme = css.split(`${selector} {`)[1].split("\n}")[0];
      const { container } = render(
        <StatusBadge tone={tone}>Status</StatusBadge>,
      );
      const classes = container.firstElementChild?.className.split(" ") ?? [];
      const foreground =
        classes.find((value) =>
          /^text-(primary|semantic|status)-/.test(value),
        ) ?? classes.find((value) => value === "text-primary");
      const background = classes.find((value) => value.startsWith("bg-"));
      if (!foreground || !background) throw new Error("Missing badge colors");
      const text = luminance(theme, foreground.slice(5));
      const fill = luminance(theme, background.slice(3));
      expect(
        (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
