import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DriveRecentsTagFilter,
  toggleTagLabelId,
} from "@/app/drive/components/drive-recents-tag-filter";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${values.count}` : key,
}));

const fetchWorkspaceLabelsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/file-search.client", () => ({
  fetchWorkspaceLabels: fetchWorkspaceLabelsMock,
}));

function renderFilter(selected: string[], onChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DriveRecentsTagFilter
        store={{ scope: "org", organizationId: "org_1" }}
        selected={selected}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("toggleTagLabelId", () => {
  it("adds a tag that is not selected and removes one that is", () => {
    expect(toggleTagLabelId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTagLabelId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("DriveRecentsTagFilter", () => {
  it("lists the workspace's tags and combines a new one with the selection", async () => {
    fetchWorkspaceLabelsMock.mockResolvedValue([
      { id: "tag_a", kind: "TAG", displayName: "Marketing" },
      { id: "tag_b", kind: "TAG", displayName: "Finance" },
    ]);
    const user = userEvent.setup();
    const onChange = renderFilter(["tag_a"]);

    await user.click(
      screen.getByRole("button", { name: "recentsTagFilterWithCount:1" }),
    );
    const finance = await screen.findByRole("checkbox", { name: "Finance" });
    expect(screen.getByRole("checkbox", { name: "Marketing" })).toBeChecked();
    expect(fetchWorkspaceLabelsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "TAG",
        store: { scope: "org", organizationId: "org_1" },
      }),
    );

    await user.click(finance);
    expect(onChange).toHaveBeenLastCalledWith(["tag_a", "tag_b"]);

    await user.click(
      screen.getByRole("button", { name: "recentsTagFilterClear" }),
    );
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("says so when the workspace has no tags yet", async () => {
    fetchWorkspaceLabelsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderFilter([]);

    await user.click(screen.getByRole("button", { name: "recentsTagFilter" }));
    await waitFor(() => {
      expect(screen.getByText("recentsTagFilterEmpty")).toBeVisible();
    });
  });
});
