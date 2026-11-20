import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useFailedSokoBotId } from "@/components/chat/personal-assistant-chrome-store";
import { useFailedSokoBotIdPublisher } from "./use-failed-soko-bot-id-publisher";

function Publisher({ failedId }: { failedId: string | null }) {
  useFailedSokoBotIdPublisher(failedId);
  return null;
}

function Probe() {
  return <output data-testid="probe">{useFailedSokoBotId() ?? "none"}</output>;
}

describe("useFailedSokoBotIdPublisher", () => {
  it("publishes the failed id before paint and clears it on recovery or unmount", () => {
    const { rerender, unmount } = render(
      <>
        <Publisher failedId="bot-1" />
        <Probe />
      </>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("bot-1");

    rerender(
      <>
        <Publisher failedId={null} />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("none");

    rerender(
      <>
        <Publisher failedId="bot-2" />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-2");

    unmount();
  });

  it("clears on React Activity hide and restores on reveal", () => {
    const { rerender } = render(
      <>
        <Activity mode="visible">
          <Publisher failedId="bot-activity" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-activity");

    rerender(
      <>
        <Activity mode="hidden">
          <Publisher failedId="bot-activity" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("none");

    rerender(
      <>
        <Activity mode="visible">
          <Publisher failedId="bot-activity" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-activity");
  });

  it("does not publish during SSR", () => {
    const html = renderToString(
      <>
        <Publisher failedId="bot-ssr" />
        <Probe />
      </>,
    );
    expect(html).toContain("none");
  });
});
