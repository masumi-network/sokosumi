import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DriveFileSnippet } from "@/app/drive/components/drive-file-snippet";

describe("DriveFileSnippet", () => {
  it("marks the highlighted span and leaves the rest as plain text", () => {
    render(
      <DriveFileSnippet
        snippet={{
          text: "findings about bicycle commuters",
          highlights: [{ start: 23, end: 32 }],
          truncatedStart: false,
          truncatedEnd: false,
        }}
      />,
    );

    const marks = screen.getAllByText("commuters");
    expect(marks).toHaveLength(1);
    expect(marks[0].tagName).toBe("MARK");
  });

  it("renders markup in the passage as text, never as elements", () => {
    const { container } = render(
      <DriveFileSnippet
        snippet={{
          text: '<img src=x onerror="alert(1)"> aurora',
          highlights: [],
          truncatedStart: false,
          truncatedEnd: false,
        }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("shows ellipses only where the window actually cuts", () => {
    const { container } = render(
      <DriveFileSnippet
        snippet={{
          text: "middle of a longer passage",
          highlights: [],
          truncatedStart: true,
          truncatedEnd: false,
        }}
      />,
    );

    expect(container.textContent?.startsWith("… ")).toBe(true);
    expect(container.textContent?.endsWith(" …")).toBe(false);
  });

  it("renders every highlight when a query matched more than once", () => {
    render(
      <DriveFileSnippet
        snippet={{
          text: "aurora and aurora",
          highlights: [
            { start: 0, end: 6 },
            { start: 11, end: 17 },
          ],
          truncatedStart: false,
          truncatedEnd: false,
        }}
      />,
    );

    expect(screen.getAllByText("aurora")).toHaveLength(2);
  });
});
