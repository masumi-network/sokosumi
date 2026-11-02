import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Collapsible } from "@/components/ui/collapsible";
import { SidebarSectionContent } from "./sidebar-section";

function contentClasses(className?: string) {
  const { container } = render(
    <Collapsible open>
      <SidebarSectionContent className={className}>rows</SidebarSectionContent>
    </Collapsible>,
  );
  return (
    container
      .querySelector('[data-slot="collapsible-content"]')
      ?.className.split(/\s+/) ?? []
  );
}

describe("SidebarSectionContent", () => {
  it("slides on the same motion as the Projects disclosure", () => {
    const classes = contentClasses();

    expect(classes).toContain(
      "motion-safe:data-[state=open]:animate-collapsible-down",
    );
    expect(classes).toContain(
      "motion-safe:data-[state=closed]:animate-collapsible-up",
    );
    expect(classes).toContain("overflow-hidden");
  });

  it("lets a caller drop the clip, which Pinned needs while its rows drag", () => {
    // `cn` is `twMerge`, so the caller's `overflow-visible` has to win
    // outright rather than land beside `overflow-hidden` and lose to it.
    const classes = contentClasses("overflow-visible");

    expect(classes).toContain("overflow-visible");
    expect(classes).not.toContain("overflow-hidden");
  });

  it("grows the clip box by the focus ring the outermost rows wear", () => {
    // The rows fill the box edge to edge, so without this the clip lands on
    // a row's own edge and cuts its `ring-2`. The margin/padding pairs cancel
    // out, so nothing else moves. In `px`, not on the spacing scale: the ring
    // is a fixed 2px, and `0.125rem` falls under it below a 16px root.
    const classes = contentClasses();

    expect(classes).toContain("-mx-2");
    expect(classes).toContain("px-2");
    expect(classes).toContain("-my-[2px]");
    expect(classes).toContain("py-[2px]");
  });

  it("leaves the strip it grew into to the heading it overlaps", () => {
    // The negative top margin puts 2px of this box over the bottom of the
    // heading above, which paints earlier and would lose those hits. The box
    // takes no pointer events and hands them back on its rows, which start
    // inside the padding.
    const classes = contentClasses();

    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("[&>*]:pointer-events-auto");
  });
});
