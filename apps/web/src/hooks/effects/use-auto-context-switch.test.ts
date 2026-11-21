import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleSelectWorkspaceMock } = vi.hoisted(() => ({
  handleSelectWorkspaceMock: vi.fn(),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    handleSelectWorkspace: handleSelectWorkspaceMock,
  }),
}));

import { useAutoContextSwitch } from "./use-auto-context-switch";

describe("useAutoContextSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches workspace once on mount when active and target differ", () => {
    const { rerender } = renderHook(
      ({ active }: { active: string | null }) =>
        useAutoContextSwitch({
          activeOrganizationId: active,
          targetOrganizationId: "org-1",
          successMessage: "Switched",
        }),
      { initialProps: { active: null as string | null } },
    );

    rerender({ active: "org-2" });

    expect(handleSelectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(handleSelectWorkspaceMock).toHaveBeenCalledWith("org-1", {
      shouldRedirectAgentJobsBasePath: false,
      shouldRedirectTaskDetailPath: false,
      successMessage: "Switched",
    });
  });

  it("does not switch when initially aligned even if props later diverge", () => {
    const { rerender } = renderHook(
      ({ active }: { active: string | null }) =>
        useAutoContextSwitch({
          activeOrganizationId: active,
          targetOrganizationId: "org-1",
          successMessage: "Switched",
        }),
      { initialProps: { active: "org-1" as string | null } },
    );

    rerender({ active: "org-2" });

    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });
});
