import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseAsString, useQueryState } from "nuqs";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import {
  SocialComposeProvider,
  useSocialCompose,
} from "./social-compose-context";

function Probe() {
  const compose = useSocialCompose();
  const [, setProjectId] = useQueryState("projectId", parseAsString);
  return (
    <div>
      <span data-testid="open">{String(compose?.open)}</span>
      <button type="button" onClick={() => compose?.setOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => compose?.setOpen(false)}>
        close
      </button>
      <button type="button" onClick={() => void setProjectId("project-b")}>
        switch-project
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

  it("closes a locally opened composer when the project changes", async () => {
    const user = userEvent.setup();

    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?projectId=project-a",
        }),
      },
    );

    await user.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("open")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "switch-project" }));
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("does not reopen from leftover compose=new when the project changes", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <SocialComposeProvider>
        <Probe />
      </SocialComposeProvider>,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?projectId=project-a&compose=new",
          onUrlUpdate,
        }),
      },
    );

    expect(screen.getByTestId("open")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "switch-project" }));
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    const event = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(event.searchParams.has("compose")).toBe(false);
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
});
