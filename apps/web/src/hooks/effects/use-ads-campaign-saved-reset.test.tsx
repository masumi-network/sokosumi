import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAdsCampaignSavedReset } from "./use-ads-campaign-saved-reset";

function SavedResetProbe({ onStartOver }: { onStartOver?: () => void }) {
  const { saved, markSaved } = useAdsCampaignSavedReset(onStartOver);
  return (
    <div>
      <span data-testid="saved">{String(saved)}</span>
      <button type="button" onClick={markSaved}>
        save
      </button>
    </div>
  );
}

describe("useAdsCampaignSavedReset", () => {
  it("resets saved state and calls onStartOver once on Activity reveal after saving", () => {
    const onStartOver = vi.fn();
    const { rerender } = render(
      <Activity mode="visible">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );

    expect(screen.getByTestId("saved")).toHaveTextContent("false");

    rerender(
      <Activity mode="hidden">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    expect(onStartOver).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "save" }));
    });
    expect(screen.getByTestId("saved")).toHaveTextContent("true");
    expect(onStartOver).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    expect(screen.getByTestId("saved")).toHaveTextContent("false");
    expect(onStartOver).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <SavedResetProbe onStartOver={onStartOver} />
      </Activity>,
    );
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });
});
