import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { contrastOf, THEMES } from "@/test/theme-tokens";

import { StatusBadge, type StatusTone } from "./status-badge";

const tones: StatusTone[] = [
  "working",
  "success",
  "warning",
  "danger",
  "accent",
];

describe("StatusBadge label contrast", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it.each(tones)(`${name} %s label clears 4.5:1 on its fill`, (tone) => {
      const { container } = render(
        <StatusBadge tone={tone}>Status</StatusBadge>,
      );
      const classes = container.firstElementChild?.className.split(" ") ?? [];
      const foreground = classes.find(
        (value) =>
          value === "text-foreground" ||
          /^text-(primary|semantic|status)-/.test(value),
      );
      const background = classes.find((value) => value.startsWith("bg-"));
      if (!foreground || !background) throw new Error("Missing badge colors");
      expect(
        contrastOf(theme, foreground.slice(5), background.slice(3)),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
