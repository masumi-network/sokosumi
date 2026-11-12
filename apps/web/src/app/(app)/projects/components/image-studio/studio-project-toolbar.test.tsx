import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  STUDIO_TOOLBAR_LABEL_CLASS,
  StudioProjectToolbar,
} from "./studio-project-toolbar";

describe("Studio project toolbar", () => {
  it("keeps the assistant's name while hiding its label on a phone", () => {
    const onAssistantToggle = vi.fn();
    render(
      <StudioProjectToolbar
        assistantControls="studio-assistant-panel"
        assistantOpen={false}
        onAssistantToggle={onAssistantToggle}
      >
        <button type="button">Brand kit</button>
      </StudioProjectToolbar>,
    );

    const assistant = screen.getByRole("button", { name: "Assistant.title" });
    expect(assistant).toHaveAttribute("aria-expanded", "false");
    expect(assistant).toHaveAttribute(
      "aria-controls",
      "studio-assistant-panel",
    );
    expect(screen.getByText("Assistant.title")).toHaveClass(
      STUDIO_TOOLBAR_LABEL_CLASS,
    );
    expect(screen.getByRole("button", { name: "Brand kit" })).toBeVisible();

    fireEvent.click(assistant);
    expect(onAssistantToggle).toHaveBeenCalledOnce();
  });
});
