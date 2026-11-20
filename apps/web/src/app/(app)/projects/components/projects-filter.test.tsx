import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectsFilter } from "@/app/projects/components/projects-filter";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const labels = { placeholder: "Filter projects", clear: "Clear filter" };

function renderFilter(searchParams = "") {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
  render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <ProjectsFilter labels={labels} startTransition={startTransition} />
    </NuqsTestingAdapter>,
  );
  return onUrlUpdate;
}

describe("ProjectsFilter", () => {
  // The real hook debounces against an env-configured delay; the component's
  // contract is "typing updates the param", not the delay itself.
  it("searches all projects on the server while keeping the chosen state", async () => {
    const onUrlUpdate = renderFilter("?state=hidden");
    const field = screen.getByRole("searchbox", { name: "Filter projects" });
    expect(
      screen.queryByRole("button", { name: labels.clear }),
    ).not.toBeInTheDocument();
    await userEvent.type(field, "aut");
    await waitFor(() => {
      const update = onUrlUpdate.mock.lastCall?.[0];
      expect(update?.searchParams.get("q")).toBe("aut");
      expect(update?.searchParams.get("state")).toBe("hidden");
      expect(update?.options.shallow).toBe(false);
    });
    expect(field).toHaveFocus();
  });

  it.each(["clear button", "Escape"])(
    "clears the query with %s and keeps focus",
    async (action) => {
      const onUrlUpdate = renderFilter("?q=autumn&state=closed");
      const field = screen.getByRole("searchbox", { name: labels.placeholder });
      if (action === "clear button") {
        await userEvent.click(
          screen.getByRole("button", { name: labels.clear }),
        );
      } else {
        await userEvent.type(field, "{Escape}");
      }
      await waitFor(() =>
        expect(onUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe(
          "state=closed",
        ),
      );
      expect(field).toHaveFocus();
    },
  );
});
