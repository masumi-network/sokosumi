import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTaskFormWorkspaceTags } from "./use-task-form-workspace-tags";

it("omits the tag patch after undoing an edit, preserving concurrent changes", () => {
  const initial = [{ id: "launch", displayName: "Launch" }];
  const { result } = renderHook(() =>
    useTaskFormWorkspaceTags("org", { workspaceTags: initial }),
  );
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

it("keeps confirmed choices while refreshed Jev matches replace only provisional tags", () => {
  const auto = { id: "a", displayName: "Company launch", autoApply: true };
  const offered = { id: "b", displayName: "Launch partner", autoApply: false };
  const { result, rerender } = renderHook(
    ({ matches }) =>
      useTaskFormWorkspaceTags(
        "one",
        {},
        { tags: [], workspaceSuggestions: matches },
      ),
    { initialProps: { matches: [auto, offered] } },
  );
  expect(result.current.workspaceTags).toEqual([
    expect.objectContaining({ id: "a", source: "jev" }),
  ]);
  expect(result.current.workspaceTagIds).toBeUndefined();
  act(() =>
    result.current.setWorkspaceTags([...result.current.workspaceTags, offered]),
  );
  expect(result.current.workspaceTagIds).toEqual(["b"]);
  rerender({ matches: [] });
  expect(result.current.workspaceTags.map((tag) => tag.id)).toEqual(["b"]);
  rerender({ matches: [auto, offered] });
  act(() => result.current.setWorkspaceTags([offered]));
  expect(result.current.dismissedWorkspaceTagIds).toEqual(["a"]);
  rerender({ matches: [auto] });
  expect(result.current.workspaceTagIds).toEqual(["b"]);
  expect(result.current.workspaceTags.map((tag) => tag.id)).toEqual(["b"]);
  act(() =>
    result.current.setWorkspaceTags([...result.current.workspaceTags, auto]),
  );
  expect(result.current.dismissedWorkspaceTagIds).toBeUndefined();
  expect(result.current.workspaceTagIds).toEqual(["b", "a"]);
});

it("keeps explicitly removed manual choices out of a late Jev response", () => {
  const preset = {
    id: "preset",
    displayName: "Design",
    taskTopicId: "design" as const,
  };
  const custom = { id: "custom", displayName: "Design" };
  const { result, rerender } = renderHook(
    ({ arrived }) =>
      useTaskFormWorkspaceTags("org", undefined, {
        tags: arrived ? ["design"] : [],
        workspaceSuggestions: arrived ? [{ ...custom, autoApply: true }] : [],
      }),
    { initialProps: { arrived: false } },
  );
  act(() => result.current.setWorkspaceTags([preset, custom]));
  act(() => result.current.setWorkspaceTags([]));
  rerender({ arrived: true });
  expect(result.current.workspaceTags).toEqual([]);
  expect(result.current.visibleTopics).toEqual([]);
  expect(result.current.dismissedWorkspaceTagIds).toEqual(["preset", "custom"]);
  expect(result.current.dismissedTopicIds).toEqual(["design"]);
  act(() => result.current.setWorkspaceTags([custom]));
  expect(result.current.dismissedTopicIds).toEqual(["design"]);
  act(() => result.current.setWorkspaceTags([custom, preset]));
  expect(result.current.dismissedWorkspaceTagIds).toBeUndefined();
  expect(result.current.dismissedTopicIds).toBeUndefined();
});

it("holds the original assignment snapshot while another editor updates the task", () => {
  const original = { id: "old", displayName: "Old" };
  const added = { id: "added", displayName: "Added" };
  const concurrent = { id: "concurrent", displayName: "Concurrent" };
  const { result, rerender } = renderHook(
    ({ tags }) => useTaskFormWorkspaceTags("org", { workspaceTags: tags }),
    { initialProps: { tags: [original] } },
  );
  act(() => result.current.setWorkspaceTags([original, added]));
  rerender({ tags: [original, concurrent] });
  expect(result.current.expectedWorkspaceTagIds).toEqual(["old"]);
  expect(result.current.workspaceTagIds).toEqual(["old", "added"]);
});
