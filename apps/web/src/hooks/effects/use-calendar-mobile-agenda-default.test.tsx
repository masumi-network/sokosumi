import { render, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { useCalendarMobileAgendaDefault } from "./use-calendar-mobile-agenda-default";

function Harness({
  isMobile,
  socialOnly,
}: {
  isMobile: boolean;
  socialOnly: boolean;
}) {
  useCalendarMobileAgendaDefault(isMobile, socialOnly);
  return null;
}

describe("useCalendarMobileAgendaDefault", () => {
  it("writes view=agenda with shallow:false on mobile when no view is set", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const [event] = onUrlUpdate.mock.calls[0];
    expect(event.searchParams.get("view")).toBe("agenda");
    expect(event.options.shallow).toBe(false);
  });

  it("replaces an invalid view param with view=agenda on mobile", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?view=bogus"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const [event] = onUrlUpdate.mock.calls[0];
    expect(event.searchParams.get("view")).toBe("agenda");
    expect(event.options.shallow).toBe(false);
  });

  it("does not write on desktop, and writes once the viewport becomes mobile", async () => {
    const onUrlUpdate = vi.fn();
    const { rerender } = render(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile={false} socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    expect(onUrlUpdate).not.toHaveBeenCalled();

    rerender(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const [event] = onUrlUpdate.mock.calls[0];
    expect(event.searchParams.get("view")).toBe("agenda");
    expect(event.options.shallow).toBe(false);
  });

  it("leaves an explicit view in the URL alone", () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?view=week"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("does not write while socialOnly is true, and writes once it clears", async () => {
    const onUrlUpdate = vi.fn();
    const { rerender } = render(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly />
      </NuqsTestingAdapter>,
    );

    expect(onUrlUpdate).not.toHaveBeenCalled();

    rerender(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness isMobile socialOnly={false} />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const [event] = onUrlUpdate.mock.calls[0];
    expect(event.searchParams.get("view")).toBe("agenda");
    expect(event.options.shallow).toBe(false);
  });
});
