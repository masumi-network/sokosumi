import type { DriveStars } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

import { DriveStarredSection } from "./drive-starred-section";

const stars = {
  folders: [{ path: "Finance/Board meetings", name: "Board meetings" }],
  files: [{ id: "f-1", displayName: "Pitch deck.pdf" }],
} as DriveStars;

function renderSection(value: DriveStars, onUnstar = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DriveStarredSection stars={value} onUnstar={onUnstar} />
    </NextIntlClientProvider>,
  );
  return onUnstar;
}

describe("DriveStarredSection", () => {
  it("opens a starred folder and a starred file in one click", () => {
    renderSection(stars);

    expect(
      screen.getByRole("heading", { name: "Starred" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Board meetings" }),
    ).toHaveAttribute(
      "href",
      "/drive?view=workspace&folder=Finance%2FBoard+meetings",
    );
    expect(
      screen.getByRole("link", { name: "Pitch deck.pdf" }),
    ).toHaveAttribute("href", "/drive/files/f-1");
  });

  it("unstars from the list", async () => {
    const onUnstar = renderSection(stars);

    await userEvent.click(
      screen.getByRole("button", { name: "Unstar Board meetings" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Unstar Pitch deck.pdf" }),
    );

    expect(onUnstar).toHaveBeenNthCalledWith(1, {
      folderPath: "Finance/Board meetings",
    });
    expect(onUnstar).toHaveBeenNthCalledWith(2, { resourceId: "f-1" });
  });

  it("shows nothing when nothing is starred", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DriveStarredSection
          stars={{ folders: [], files: [] }}
          onUnstar={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
