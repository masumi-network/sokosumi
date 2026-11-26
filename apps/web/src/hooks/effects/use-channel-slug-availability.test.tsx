import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkSlugMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/actions", () => ({
  checkChannelSlugAvailabilityAction: checkSlugMock,
}));

import type { CreateChannelWizard } from "@/app/chat/components/create-channel-wizard";
import { useChannelSlugAvailability } from "./use-channel-slug-availability";

function SlugProbe({
  step,
  createStepSlug,
}: {
  step: "create" | "add-people";
  createStepSlug: string;
}) {
  const wizard = { step } as CreateChannelWizard;
  const { availability } = useChannelSlugAvailability(wizard, createStepSlug);
  return <span data-testid="availability">{availability}</span>;
}

describe("useChannelSlugAvailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkSlugMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks empty slug invalid, debounces checks by 300ms on create step, and handles error responses", async () => {
    checkSlugMock
      .mockResolvedValueOnce({ ok: true, value: { status: "available" } })
      .mockResolvedValueOnce({ ok: false, error: { message: "failed" } });

    const { rerender, unmount } = render(
      <SlugProbe step="create" createStepSlug="" />,
    );
    expect(screen.getByTestId("availability")).toHaveTextContent("invalid");

    rerender(<SlugProbe step="create" createStepSlug="design" />);
    expect(screen.getByTestId("availability")).toHaveTextContent("unknown");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(checkSlugMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkSlugMock).toHaveBeenCalledExactlyOnceWith("design");
    expect(screen.getByTestId("availability")).toHaveTextContent("available");

    rerender(<SlugProbe step="create" createStepSlug="broken" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId("availability")).toHaveTextContent("error");

    // Non-create step does not run another check.
    rerender(<SlugProbe step="add-people" createStepSlug="" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(checkSlugMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("cancels timers on StrictMode replay and Activity hide, and ignores late results after unmount", async () => {
    const pending = Promise.withResolvers<{
      ok: true;
      value: { status: "taken" };
    }>();
    checkSlugMock.mockReturnValueOnce(pending.promise);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <SlugProbe step="create" createStepSlug="team" />
        </Activity>
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <SlugProbe step="create" createStepSlug="team" />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(checkSlugMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <SlugProbe step="create" createStepSlug="team" />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(checkSlugMock).toHaveBeenCalledTimes(1);

    // Hide while request is in flight: late resolution must be ignored.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <SlugProbe step="create" createStepSlug="team" />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      pending.resolve({ ok: true, value: { status: "taken" } });
      await pending.promise;
    });
    expect(screen.getByTestId("availability")).toHaveTextContent("unknown");

    unmount();
  });
});
