import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBriefingField } from "@/app/projects/components/project-briefing-field";

const copy = vi.hoisted(() => ({
  query: {
    isPending: false,
    isError: false,
    hasNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  },
  sources: [] as { id: string; name: string }[],
  readBriefing: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@/app/projects/components/use-briefing-copy-sources", () => ({
  useBriefingCopySources: (open: boolean, targetId: string) => {
    copy.open(open, targetId);
    return copy;
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "label") return "Briefing";
      if (key === "placeholder") return "Describe the campaign";
      if (key === "guidance") return "Describe the campaign/initiative";
      if (key === "wordCount") return `${values?.count ?? 0} words`;
      if (key === "encouragement") return "Great briefings are 300+ words";
      if (key === "encouragementMet") return "Strong briefing";
      if (key === "chips.goals") return "Goals";
      if (key.startsWith("chips.")) return key.slice("chips.".length);
      if (key === "copy.copied") return `Copied from ${values?.name}.`;
      return key;
    };
  },
}));

function StatefulField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ProjectBriefingField
      value={value}
      onChange={setValue}
      copyIntoProjectId="target"
    />
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "copy.trigger" }));
  return screen.findByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(copy.query, {
    isPending: false,
    isError: false,
    hasNextPage: false,
  });
  copy.sources = [{ id: "a", name: "Alpha" }];
  copy.readBriefing.mockResolvedValue("Alpha brief");
});

describe("ProjectBriefingField", () => {
  it("inserts a heading chip and updates the word count", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    const { rerender } = render(
      <ProjectBriefingField value="" onChange={handleChange} />,
    );

    expect(screen.getByTestId("briefing-word-count")).toHaveTextContent(
      "0 words",
    );
    await user.click(screen.getByTestId("briefing-chip-goals"));
    expect(handleChange).toHaveBeenCalledWith("## Goals\n");

    rerender(
      <ProjectBriefingField
        value={"## Goals\nWin the quarter"}
        onChange={handleChange}
      />,
    );
    expect(screen.getByTestId("briefing-word-count")).toHaveTextContent(
      "5 words",
    );
  });

  it("reads the sources only once the menu opens", async () => {
    const user = userEvent.setup();
    render(<StatefulField initial="" />);

    expect(copy.open).toHaveBeenLastCalledWith(false, "target");
    await openMenu(user);
    expect(copy.open).toHaveBeenLastCalledWith(true, "target");
  });

  it("replaces the draft with a copied briefing, and Undo by keyboard restores it", async () => {
    const user = userEvent.setup();
    render(<StatefulField initial="Old draft" />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Alpha" }));

    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("Alpha brief");
    expect(copy.readBriefing).toHaveBeenCalledWith("a");
    expect(screen.getByRole("status")).toHaveTextContent("Copied from Alpha.");

    // Focus returns to the menu button; Undo is the next stop.
    await user.tab();
    expect(screen.getByRole("button", { name: "copy.undo" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(field).toHaveValue("Old draft");
    expect(field).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "copy.undo" }),
    ).not.toBeInTheDocument();
  });

  it("drops Undo once the copied text is edited", async () => {
    const user = userEvent.setup();
    render(<StatefulField initial="" />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Alpha" }));
    await screen.findByRole("button", { name: "copy.undo" });
    await user.type(screen.getByRole("textbox"), " More.");

    expect(screen.getByRole("textbox")).toHaveValue("Alpha brief More.");
    expect(
      screen.queryByRole("button", { name: "copy.undo" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the draft and says so when the picked briefing cannot be read", async () => {
    const user = userEvent.setup();
    copy.readBriefing.mockRejectedValue(new Error("Core is down"));
    render(<StatefulField initial="Old draft" />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Alpha" }));

    expect(await screen.findByRole("status")).toHaveTextContent("copy.failed");
    expect(screen.getByRole("textbox")).toHaveValue("Old draft");
  });

  it("offers a retry in the menu when the list fails, and editing goes on", async () => {
    const user = userEvent.setup();
    copy.query.isError = true;
    copy.sources = [];
    render(<StatefulField initial="Old draft" />);

    const menu = await openMenu(user);
    expect(menu).toHaveTextContent("copy.loadFailed");
    await user.click(screen.getByRole("menuitem", { name: "copy.retry" }));

    expect(copy.query.refetch).toHaveBeenCalled();
    // The open menu hides the rest of the dialog from the a11y tree.
    expect(screen.getByRole("textbox", { hidden: true })).toHaveValue(
      "Old draft",
    );
  });

  it("loads the next page from the menu without closing it", async () => {
    const user = userEvent.setup();
    copy.query.hasNextPage = true;
    render(<StatefulField initial="" />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "copy.more" }));

    expect(copy.query.fetchNextPage).toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("has no copy menu outside Edit", () => {
    render(<ProjectBriefingField value="" onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "copy.trigger" }),
    ).not.toBeInTheDocument();
  });
});
