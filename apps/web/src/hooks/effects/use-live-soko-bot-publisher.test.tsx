import { SokoBotStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getLiveSokoBot,
  useLiveSokoBotStatus,
} from "@/components/chat/personal-assistant-chrome-store";
import { useLiveSokoBotPublisher } from "./use-live-soko-bot-publisher";

function Publisher({ failedId }: { failedId: string | null }) {
  useLiveSokoBotPublisher({
    id: failedId ?? "bot-ok",
    status: failedId ? SokoBotStatus.ERROR : SokoBotStatus.IDLE,
    lastActivityAt: null,
  });
  return null;
}

function failedIdOf(bot: ReturnType<typeof getLiveSokoBot>) {
  return bot?.status === SokoBotStatus.ERROR ? bot.id : null;
}

function Probe() {
  const bot = useLiveSokoBotStatus();
  return <output data-testid="probe">{bot ? bot.id : "none"}</output>;
}

describe("useLiveSokoBotPublisher", () => {
  it("publishes the bot before paint and follows its status", () => {
    const observedDuringLayout: Array<string | null> = [];

    function FollowingLayoutSibling() {
      useLayoutEffect(() => {
        observedDuringLayout.push(failedIdOf(getLiveSokoBot()));
      });
      return null;
    }

    const { rerender, unmount } = render(
      <>
        <Publisher failedId="bot-1" />
        <FollowingLayoutSibling />
        <Probe />
      </>,
    );

    expect(observedDuringLayout[0]).toBe("bot-1");
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-1");

    rerender(
      <>
        <Publisher failedId={null} />
        <FollowingLayoutSibling />
        <Probe />
      </>,
    );
    expect(observedDuringLayout.at(-1)).toBeNull();
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-ok");

    rerender(
      <>
        <Publisher failedId="bot-2" />
        <FollowingLayoutSibling />
        <Probe />
      </>,
    );
    expect(observedDuringLayout.at(-1)).toBe("bot-2");
    expect(screen.getByTestId("probe")).toHaveTextContent("bot-2");

    unmount();
    expect(getLiveSokoBot()).toBeNull();
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
