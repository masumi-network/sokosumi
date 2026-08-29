import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      allVersions: "All versions",
      versionFilter: "Filter by version",
    })[key] ?? key,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select
      id="quality-version"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { QualityVersionFilter } from "@/components/admin/soko-bots/quality-version-filter.client";

const versions = [
  { versionId: "test-v1", name: "Test one" },
  { versionId: "test-v2", name: "Test two" },
];

describe("QualityVersionFilter", () => {
  it("uses the version name as the option label", () => {
    render(<QualityVersionFilter versions={versions} />, {
      wrapper: withNuqsTestingAdapter({}),
    });

    expect(
      screen.getByRole("option", { name: "Test two" }),
    ).toBeInTheDocument();
  });

  it("updates the version URL state with a server refresh", async () => {
    const onUrlUpdate = vi.fn();
    render(<QualityVersionFilter versions={versions} />, {
      wrapper: withNuqsTestingAdapter({ onUrlUpdate }),
    });

    fireEvent.change(screen.getByLabelText("Filter by version"), {
      target: { value: "test-v2" },
    });

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const event = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(event?.searchParams.get("qualityVersion")).toBe("test-v2");
    expect(event?.options.shallow).toBe(false);
  });

  it("uses all versions by default and removes the filter from the URL", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <QualityVersionFilter selectedVersionId="test-v1" versions={versions} />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?qualityVersion=test-v1",
          onUrlUpdate,
        }),
      },
    );

    fireEvent.change(screen.getByLabelText("Filter by version"), {
      target: { value: "all" },
    });

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const event = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(event?.searchParams.has("qualityVersion")).toBe(false);
  });
});
