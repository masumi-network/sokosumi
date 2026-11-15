import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactsBulkBar } from "./contacts-toolbar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ContactsBulkBar", () => {
  it("sets one relationship on the selected contacts", async () => {
    const onSetStage = vi.fn();
    render(
      <ContactsBulkBar
        count={3}
        lists={[]}
        viewList={null}
        onSetStage={onSetStage}
        onAddToList={vi.fn()}
        onRemoveFromList={vi.fn()}
        onMerge={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "bulk.setStage" }),
    );
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "stages.CUSTOMER" }),
    );
    expect(onSetStage).toHaveBeenCalledExactlyOnceWith("CUSTOMER");
  });
});
