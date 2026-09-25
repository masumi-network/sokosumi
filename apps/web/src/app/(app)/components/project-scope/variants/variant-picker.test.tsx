import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: { current: "/tasks" },
  search: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname.current,
  useSearchParams: () => mocks.search.current,
}));

import { SCOPE_VARIANT_STORAGE_KEY } from "./scope-variants";
import { ScopeVariantPicker } from "./variant-picker";

function renderPicker(search: string) {
  mocks.search.current = new URLSearchParams(search);
  return render(<ScopeVariantPicker />);
}

function variantButton(id: string) {
  const button = document.querySelector<HTMLElement>(`[data-variant="${id}"]`);
  if (!button) throw new Error(`No button for ${id}`);
  return button;
}

function lastReplacedVariant() {
  const href = mocks.replace.mock.lastCall?.[0];
  if (typeof href !== "string") return null;
  return new URLSearchParams(href.split("?")[1]).get("variant");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname.current = "/tasks";
  sessionStorage.clear();
});

describe("ScopeVariantPicker", () => {
  it("renders nothing until a variant link opts in", () => {
    const { container } = renderPicker("projectId=p-1");

    expect(container).toBeEmptyDOMElement();
  });

  it("renders after a stored choice alone", () => {
    sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, "hub");

    renderPicker("");

    expect(
      screen.getByRole("navigation", { name: "SOK-1202 variants" }),
    ).toBeInTheDocument();
    expect(variantButton("hub")).toHaveAttribute("aria-current", "true");
  });

  it("stores a URL variant so it survives navigation", () => {
    renderPicker("variant=header");

    expect(sessionStorage.getItem(SCOPE_VARIANT_STORAGE_KEY)).toBe("header");
    expect(variantButton("header")).toHaveAttribute("aria-current", "true");
  });

  it("replaces the URL with the chosen variant and keeps other params", async () => {
    renderPicker("projectId=p-1&variant=header");

    await userEvent.click(screen.getByRole("button", { name: "Project hub" }));

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith(
      "/tasks?projectId=p-1&variant=hub",
      { scroll: false },
    );
    expect(sessionStorage.getItem(SCOPE_VARIANT_STORAGE_KEY)).toBe("hub");
  });

  it("moves to the next variant on ArrowRight and focuses it", () => {
    renderPicker("variant=header");

    fireEvent.keyDown(variantButton("header"), { key: "ArrowRight" });

    expect(lastReplacedVariant()).toBe("combined");
    expect(document.activeElement).toBe(variantButton("combined"));
  });

  it("wraps from the last variant to the first on ArrowRight", () => {
    renderPicker("variant=hub");

    fireEvent.keyDown(variantButton("hub"), { key: "ArrowRight" });

    expect(lastReplacedVariant()).toBe("current");
  });

  it("wraps from the first variant to the last on ArrowLeft", () => {
    renderPicker("variant=current");

    fireEvent.keyDown(variantButton("current"), { key: "ArrowLeft" });

    expect(lastReplacedVariant()).toBe("hub");
  });

  it("jumps to a variant by its digit", () => {
    renderPicker("variant=current");

    fireEvent.keyDown(variantButton("current"), { key: "3" });
    expect(lastReplacedVariant()).toBe("header");

    fireEvent.keyDown(variantButton("current"), { key: "6" });
    expect(lastReplacedVariant()).toBe("hub");
  });

  it("ignores digits outside 1 to 6 and other keys", () => {
    renderPicker("variant=current");
    const button = variantButton("current");

    for (const key of ["0", "7", "9", "a", "Enter"]) {
      fireEvent.keyDown(button, { key });
    }

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("ignores modified keys", () => {
    renderPicker("variant=header");
    const button = variantButton("header");

    fireEvent.keyDown(button, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(button, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(button, { key: "1", ctrlKey: true });
    fireEvent.keyDown(button, { key: "2", metaKey: true });

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does nothing for a keydown outside the picker", () => {
    renderPicker("variant=header");

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "1" });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SCOPE_VARIANT_STORAGE_KEY)).toBe("header");
  });
});
