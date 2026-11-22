import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDriveTasksItemsLoad } from "./use-drive-tasks-items-load";

describe("useDriveTasksItemsLoad", () => {
  it("loads task items only when isTasksView is true and reloads when the loader changes", () => {
    const firstLoad = vi.fn(async () => {});
    const secondLoad = vi.fn(async () => {});

    const { rerender } = renderHook(
      ({ isTasksView, load }) => useDriveTasksItemsLoad(isTasksView, load),
      { initialProps: { isTasksView: false, load: firstLoad } },
    );

    expect(firstLoad).not.toHaveBeenCalled();

    rerender({ isTasksView: true, load: firstLoad });
    expect(firstLoad).toHaveBeenCalledTimes(1);

    rerender({ isTasksView: true, load: secondLoad });
    expect(secondLoad).toHaveBeenCalledTimes(1);
  });
});
