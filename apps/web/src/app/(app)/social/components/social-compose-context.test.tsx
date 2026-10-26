import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import {
  SocialComposeProvider,
  useSocialCompose,
} from "./social-compose-context";

function Probe() {
  const compose = useSocialCompose();
  return (
    <div>
      <span data-testid="open">{String(compose?.open)}</span>
      <span data-testid="scheduled-at">
        {compose?.scheduledAt?.toISOString() ?? "none"}
      </span>
      <button type="button" onClick={() => compose?.setOpen(true)}>
        open
      </button>
      <button
        type="button"
        onClick={() =>
          compose?.setOpen(true, {
            scheduledAt: new Date("2030-01-09T08:00:00.000Z"),
          })
        }
      >
        plan
      </button>
      <button type="button" onClick={() => compose?.setOpen(false)}>
        close
      </button>
    </div>
  );
}

describe("SocialComposeProvider", () => {
  it("opens from ?compose=new", () => {
    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      { wrapper: withNuqsTestingAdapter({ searchParams: "?compose=new" }) },
    );

    expect(screen.getByTestId("open")).toHaveTextContent("true");
  });

  it("stays closed without compose=new", () => {
    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      { wrapper: withNuqsTestingAdapter({ searchParams: "" }) },
    );

    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("clears compose=new when the composer closes", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?compose=new",
          onUrlUpdate,
        }),
      },
    );

    await user.click(screen.getByRole("button", { name: "close" }));

    expect(screen.getByTestId("open")).toHaveTextContent("false");
    expect(onUrlUpdate).toHaveBeenCalled();
    const event = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(event.searchParams.has("compose")).toBe(false);
  });

  it("carries a calendar day's time while open and drops it on close", async () => {
    const user = userEvent.setup();
    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      { wrapper: withNuqsTestingAdapter({ searchParams: "" }) },
    );

    await user.click(screen.getByRole("button", { name: "plan" }));
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(screen.getByTestId("scheduled-at")).toHaveTextContent(
      "2030-01-09T08:00:00.000Z",
    );

    await user.click(screen.getByRole("button", { name: "close" }));
    await user.click(screen.getByRole("button", { name: "open" }));
    // The New post menu opens a composer with no time picked.
    expect(screen.getByTestId("scheduled-at")).toHaveTextContent("none");
  });
});
