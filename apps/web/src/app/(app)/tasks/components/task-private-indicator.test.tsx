import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskVisibility } from "@/lib/clients/generated/core";

import { TaskPrivateIndicator } from "./task-private-indicator";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "privateBadge" ? "Private" : key,
}));

describe("TaskPrivateIndicator", () => {
  it("renders an accessible Private label for PRIVATE tasks", () => {
    render(<TaskPrivateIndicator visibility={TaskVisibility.PRIVATE} />);

    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("renders nothing for PUBLIC tasks", () => {
    const { container } = render(
      <TaskPrivateIndicator visibility={TaskVisibility.PUBLIC} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
