import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

it.each([true, false])("handles tooltip focus when hover is unavailable: %s", async (noHover) => {
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: noHover } as MediaQueryList);
  try {
    render(
      <Tooltip>
        <TooltipTrigger>New task</TooltipTrigger>
        <TooltipContent>Keyboard shortcut</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "New task" });
    act(() => trigger.focus());
    if (noHover) {
      expect(trigger).toHaveAttribute("data-state", "closed");
      expect(screen.queryByRole("tooltip")).toBeNull();
    } else {
      expect(await screen.findByRole("tooltip")).toHaveTextContent("Keyboard shortcut");
    }
  } finally {
    media.mockRestore();
  }
});
