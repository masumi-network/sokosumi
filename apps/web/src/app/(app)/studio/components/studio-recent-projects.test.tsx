import { fireEvent, render, screen } from "@testing-library/react";
import { createFormatter } from "next-intl";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  registerStudioWorkspaceBrief,
  takeStudioBriefFor,
} from "@/app/projects/components/image-studio/studio-workspace-brief";

import {
  recentProjectDate,
  StudioRecentProjects,
} from "./studio-recent-projects";

vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Nov 11" }),
}));

vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

// happy-dom fetches no image, so every <img> reads as finished and empty: a
// failed load. A browser still loading it says `complete: false`.
const IMAGE_COMPLETE = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "complete",
);
beforeAll(() => {
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => false,
  });
});
afterAll(() => {
  if (IMAGE_COMPLETE) {
    Object.defineProperty(
      HTMLImageElement.prototype,
      "complete",
      IMAGE_COMPLETE,
    );
  }
});

const PROJECTS = [
  {
    projectId: "project-1",
    projectName: "Autumn menu",
    imageCount: 24,
    latestAt: new Date("2026-11-11T10:00:00.000Z"),
    latestImageId: "asset-9",
  },
];

let unregister = () => {};
afterEach(() => {
  unregister();
  takeStudioBriefFor(null);
});

function renderCards() {
  unregister = registerStudioWorkspaceBrief(() => "Summer sale for oat lattes");
  render(<StudioRecentProjects now={new Date()} projects={PROJECTS} />);
  return screen.getByRole("link", { name: /Autumn menu/ });
}

describe("StudioRecentProjects", () => {
  it("takes the typed brief to the project a card opens, and only there", () => {
    const card = renderCards();

    fireEvent.click(card);
    expect(takeStudioBriefFor("project-1")).toBe("Summer sale for oat lattes");
    // Once: a later visit opens empty.
    expect(takeStudioBriefFor("project-1")).toBeNull();

    fireEvent.click(card);
    expect(takeStudioBriefFor("project-2")).toBeNull();
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { button: 1 },
  ])("leaves the brief in place for a new tab or window (%o)", (init) => {
    fireEvent.click(renderCards(), init);

    expect(takeStudioBriefFor("project-1")).toBeNull();
  });
});

describe("StudioRecentProjects thumbnail", () => {
  it("keeps a plain tile, not a broken image, when the bytes cannot be read", () => {
    const card = renderCards();
    const image = card.querySelector("img");
    expect(image).toHaveAttribute(
      "src",
      "/api/projects/project-1/image-studio/assets/asset-9/content",
    );

    fireEvent.error(image as HTMLImageElement);

    expect(card.querySelector("img")).toBeNull();
    expect(card).toHaveTextContent("Autumn menu");
  });
});

describe("recentProjectDate", () => {
  // On 1 January 2027 in Los Angeles, an image from 00:30 UTC that day is
  // still 31 December 2026 there, so it needs its year.
  const format = createFormatter({
    locale: "en",
    timeZone: "America/Los_Angeles",
  });
  const now = new Date("2027-01-01T20:00:00.000Z");

  it("shows the year when the date falls in last year in the viewer's zone", () => {
    expect(
      recentProjectDate(format, new Date("2027-01-01T00:30:00.000Z"), now),
    ).toBe("Dec 31, 2026");
  });

  it("leaves the year out within this year in the viewer's zone", () => {
    expect(
      recentProjectDate(format, new Date("2027-01-01T09:00:00.000Z"), now),
    ).toBe("Jan 1");
  });
});
