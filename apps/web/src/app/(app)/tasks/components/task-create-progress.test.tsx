import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskCreateProgress } from "./task-create-progress";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function steps() {
  return screen.getAllByRole("listitem").map((item) => item.textContent);
}

describe("TaskCreateProgress", () => {
  it("keeps an empty live region until the request starts", () => {
    render(
      <TaskCreateProgress
        active={false}
        needsName
        tagsReady={false}
        isCopy={false}
      />,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("lists Core's steps in order and ticks only what is already done", () => {
    render(<TaskCreateProgress active needsName tagsReady isCopy={false} />);

    expect(steps()).toEqual(["naming", "tagsReady", "saving"]);
    expect(screen.getByText("keepOpen")).toBeTruthy();
  });

  it("skips naming for a typed name and suggests tags in the request", () => {
    render(
      <TaskCreateProgress
        active
        needsName={false}
        tagsReady={false}
        isCopy={false}
      />,
    );
    expect(steps()).toEqual(["tagging", "saving"]);
  });

  it("only saves a copy", () => {
    render(<TaskCreateProgress active needsName tagsReady={false} isCopy />);
    expect(steps()).toEqual(["saving"]);
  });
});
