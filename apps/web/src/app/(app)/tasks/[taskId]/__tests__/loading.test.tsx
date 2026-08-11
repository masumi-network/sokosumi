import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TaskDetailLoading from "@/app/tasks/[taskId]/loading";

describe("TaskDetailLoading", () => {
  it("relies on outer main padding on mobile and keeps md horizontal pad", () => {
    const { container } = render(<TaskDetailLoading />);

    const shell = container.querySelector(".mx-auto.max-w-4xl");
    expect(shell?.className).toContain("pb-8");
    expect(shell?.className).toContain("md:px-4");
    expect(shell?.className.split(/\s+/)).not.toContain("px-2");
  });
});
