import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTaskFormWorkspaceTags } from "./use-task-form-workspace-tags";

it("omits the tag patch after undoing an edit, preserving concurrent changes", () => {
  const initial = [{ id: "launch", displayName: "Launch" }];
  const { result } = renderHook(() => useTaskFormWorkspaceTags("org", initial));
  act(() => result.current.setWorkspaceTags([]));
  expect(result.current.workspaceTagIds).toEqual([]);
  act(() => result.current.setWorkspaceTags([...initial]));
  expect(result.current.workspaceTagIds).toBeUndefined();
});

it("does not submit a selection from a previous workspace", () => {
  const { result, rerender } = renderHook(
    ({ workspace }) => useTaskFormWorkspaceTags(workspace),
    { initialProps: { workspace: "one" } },
  );
  act(() =>
    result.current.setWorkspaceTags([
      { id: "old", displayName: "Old workspace" },
    ]),
  );
  rerender({ workspace: "two" });
  expect(result.current.workspaceTags).toEqual([]);
  expect(result.current.workspaceTagIds).toBeUndefined();
});
