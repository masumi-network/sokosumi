import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { RecordProjectVisit } from "./record-project-visit";

const STORAGE_KEY = "sokosumi.sidebar.recent-projects.v1";

function log(): unknown {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
}

describe("RecordProjectVisit", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records the visit and renders nothing", () => {
    const { container } = render(<RecordProjectVisit projectId="project-1" />);

    expect(log()).toEqual(["project-1"]);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts the newest project in front of an earlier visit", () => {
    render(<RecordProjectVisit projectId="project-1" />);
    render(<RecordProjectVisit projectId="project-2" />);

    expect(log()).toEqual(["project-2", "project-1"]);
  });

  it("stays mounted without re-recording when nothing remounts it", () => {
    const view = render(<RecordProjectVisit projectId="project-1" />);
    render(<RecordProjectVisit projectId="project-2" />);
    view.rerender(<RecordProjectVisit projectId="project-1" />);

    expect(log()).toEqual(["project-2", "project-1"]);
  });
});
