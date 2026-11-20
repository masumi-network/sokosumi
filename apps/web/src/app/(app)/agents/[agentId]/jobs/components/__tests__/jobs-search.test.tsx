import { act, fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, expect, it, vi } from "vitest";
import { getEnvPublicConfig } from "@/config/env.public";
import { JobsSearch } from "../jobs-search";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents/agent-id/jobs",
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(() => vi.useRealTimers());

it("keeps the shortcut hint beside a nonempty search", () => {
  render(
    <NuqsTestingAdapter searchParams="?query=report">
      <JobsSearch jobs={[]} />
    </NuqsTestingAdapter>,
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(screen.getByText(/^(⌘F|controlShortcut)$/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "clear" })).toBeInTheDocument();
});

it("clears a pending search before its debounced URL update can restore it", async () => {
  vi.useFakeTimers();
  render(
    <NuqsTestingAdapter hasMemory>
      <JobsSearch jobs={[]} />
    </NuqsTestingAdapter>,
  );
  const field = screen.getByRole("textbox");
  fireEvent.change(field, { target: { value: "report" } });
  fireEvent.keyDown(field, { key: "Escape" });
  await act(() =>
    vi.advanceTimersByTimeAsync(
      getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME + 50,
    ),
  );
  expect(field).toHaveValue("");
  expect(field).toHaveFocus();
});
