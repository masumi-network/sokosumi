import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksMobileCreateFabSlot } from "./tasks-mobile-create-fab-slot";

const { isMobileMock } = vi.hoisted(() => ({ isMobileMock: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: isMobileMock }));
vi.mock("@/hooks/use-is-apple-platform", () => ({ default: () => false }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpen: vi.fn() }),
}));

const offset = () =>
  document.documentElement.style.getPropertyValue("--toast-bottom-offset");

describe("TasksMobileCreateFabSlot toast offset", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--toast-bottom-offset");
  });

  it("lifts toasts above the tab bar and the + button below md", () => {
    isMobileMock.mockReturnValue(true);
    render(<TasksMobileCreateFabSlot />);
    expect(offset()).toContain("3.5rem");
  });

  it("leaves toasts where they are from md up", () => {
    isMobileMock.mockReturnValue(false);
    render(<TasksMobileCreateFabSlot />);
    expect(offset()).toBe("");
  });

  it("drops the offset when the window grows past md", () => {
    isMobileMock.mockReturnValue(true);
    const { rerender } = render(<TasksMobileCreateFabSlot />);
    isMobileMock.mockReturnValue(false);
    rerender(<TasksMobileCreateFabSlot />);
    expect(offset()).toBe("");
  });

  it("drops the offset when leaving the board", () => {
    isMobileMock.mockReturnValue(true);
    const { unmount } = render(<TasksMobileCreateFabSlot />);
    unmount();
    expect(offset()).toBe("");
  });
});
