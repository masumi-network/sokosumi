import type { Contact, ContactDuplicateGroup } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicatesDialog } from "./duplicates-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function contact(id: string, channels: Contact["channels"]): Contact {
  return {
    id,
    name: "Adam Rusch",
    kind: "PERSON",
    organization: null,
    avatarUrl: null,
    channels,
  } as unknown as Contact;
}

const group: ContactDuplicateGroup = {
  name: "adam rusch",
  contacts: [
    contact("c-1", []),
    contact("c-2", [
      {
        type: "EMAIL",
        value: "adam@example.com",
        isPrimary: true,
      } as Contact["channels"][number],
    ]),
  ],
};

function renderDialog(groups: ContactDuplicateGroup[]) {
  const props = { onMerge: vi.fn(), onOpenContact: vi.fn(), onClose: vi.fn() };
  render(<DuplicatesDialog groups={groups} {...props} />);
  return props;
}

describe("DuplicatesDialog", () => {
  it("lists each record with what tells it apart", () => {
    renderDialog([group]);
    expect(screen.getByText("noDetails")).toBeInTheDocument();
    expect(screen.getByText("adam@example.com")).toBeInTheDocument();
  });

  it("merges the whole group", () => {
    const props = renderDialog([group]);
    fireEvent.click(screen.getByRole("button", { name: "mergeGroup" }));
    expect(props.onMerge).toHaveBeenCalledWith(group.contacts);
  });

  it("opens a record to check it first", () => {
    const props = renderDialog([group]);
    fireEvent.click(screen.getByText("adam@example.com"));
    expect(props.onOpenContact).toHaveBeenCalledWith("c-2");
  });

  it("says there are more when Core returned a full page", () => {
    render(
      <DuplicatesDialog
        groups={[group]}
        capped
        onMerge={vi.fn()}
        onOpenContact={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("titleMore");
  });

  it("says so when nothing is left", () => {
    renderDialog([]);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
