import { render, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberFollowAfterSetup,
  type TaskFollowArm,
  useTaskFollowAfterSetup,
} from "./use-task-follow-after-setup";

const FOLLOW_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

function Harness({
  taskId,
  arm,
  onFollow,
}: {
  taskId: string;
  arm: TaskFollowArm;
  onFollow: () => void;
}) {
  useTaskFollowAfterSetup(taskId, arm, onFollow);
  return null;
}

describe("useTaskFollowAfterSetup", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("follows once on return from setup under StrictMode and clears marker and storage", async () => {
    const onFollow = vi.fn();
    const onUrlUpdate = vi.fn();
    rememberFollowAfterSetup("task-1");

    render(
      <StrictMode>
        <NuqsTestingAdapter
          searchParams="?follow=1"
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <Harness taskId="task-1" arm="add" onFollow={onFollow} />
        </NuqsTestingAdapter>
      </StrictMode>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.get("follow"),
    ).toBeNull();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it("keeps the hand-off while arm is setup and follows once when the bot arrives under StrictMode", async () => {
    const firstOnFollow = vi.fn();
    const secondOnFollow = vi.fn();
    const onUrlUpdate = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { rerender } = render(
      <StrictMode>
        <NuqsTestingAdapter
          searchParams="?follow=1"
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <Harness taskId="task-1" arm="setup" onFollow={firstOnFollow} />
        </NuqsTestingAdapter>
      </StrictMode>,
    );

    expect(firstOnFollow).not.toHaveBeenCalled();
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");

    rerender(
      <StrictMode>
        <NuqsTestingAdapter
          searchParams="?follow=1"
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <Harness taskId="task-1" arm="add" onFollow={secondOnFollow} />
        </NuqsTestingAdapter>
      </StrictMode>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(firstOnFollow).not.toHaveBeenCalled();
    expect(secondOnFollow).toHaveBeenCalledTimes(1);
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.get("follow"),
    ).toBeNull();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it("clears the marker and stored task without following when already active", async () => {
    const onFollow = vi.fn();
    const onUrlUpdate = vi.fn();
    rememberFollowAfterSetup("task-1");

    render(
      <NuqsTestingAdapter
        searchParams="?follow=1"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness taskId="task-1" arm="active" onFollow={onFollow} />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onFollow).not.toHaveBeenCalled();
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.get("follow"),
    ).toBeNull();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it.each([
    ["no stored task", null],
    ["a different stored task", "task-2"],
  ])(
    "clears the marker without following when sessionStorage has %s",
    async (_label, stored) => {
      const onFollow = vi.fn();
      const onUrlUpdate = vi.fn();
      if (stored) rememberFollowAfterSetup(stored);

      render(
        <NuqsTestingAdapter
          searchParams="?follow=1"
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <Harness taskId="task-1" arm="add" onFollow={onFollow} />
        </NuqsTestingAdapter>,
      );

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
      expect(onFollow).not.toHaveBeenCalled();
      expect(
        onUrlUpdate.mock.lastCall?.[0].searchParams.get("follow"),
      ).toBeNull();
      expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
    },
  );

  it("does nothing when the follow marker is absent or arm is null", () => {
    const onFollow = vi.fn();
    const onUrlUpdate = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { rerender } = render(
      <NuqsTestingAdapter searchParams="" onUrlUpdate={onUrlUpdate} hasMemory>
        <Harness taskId="task-1" arm="add" onFollow={onFollow} />
      </NuqsTestingAdapter>,
    );

    expect(onFollow).not.toHaveBeenCalled();
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");

    rerender(
      <NuqsTestingAdapter
        searchParams="?follow=1"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness taskId="task-1" arm={null} onFollow={onFollow} />
      </NuqsTestingAdapter>,
    );

    expect(onFollow).not.toHaveBeenCalled();
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");
  });
});
