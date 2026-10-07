import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TagIcon } from "@/components/agents/tag-icon";

describe("TagIcon", () => {
  it("renders a brand svg for a recognized model tag", () => {
    const { container } = render(<TagIcon name="GPT-4o" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a region flag for a known region tag", () => {
    render(<TagIcon name="EU" />);
    expect(screen.getByText("🇪🇺")).toBeInTheDocument();
  });

  it("renders nothing for an unrecognized tag", () => {
    const { container } = render(<TagIcon name="custom-tag" />);
    expect(container).toBeEmptyDOMElement();
  });
});
