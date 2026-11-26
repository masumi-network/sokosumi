import { render } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ComposerActiveFormats } from "@/lib/utils/composer-active-formats";
import { useComposerActiveFormatsPublish } from "./use-composer-active-formats-publish";

describe("useComposerActiveFormatsPublish", () => {
  it("publishes in the passive phase when a subscriber attaches or changes, and skips unrelated rerenders", () => {
    const events: string[] = [];
    const publishA = vi.fn(() => {
      events.push("publishA");
    });
    const publishB = vi.fn(() => {
      events.push("publishB");
    });
    const listenerA = vi.fn<(formats: ComposerActiveFormats) => void>();
    const listenerB = vi.fn<(formats: ComposerActiveFormats) => void>();

    function Probe({
      onActiveFormatsChange,
      publishActiveFormats,
      tick: _tick,
    }: {
      onActiveFormatsChange?: (formats: ComposerActiveFormats) => void;
      publishActiveFormats: () => void;
      tick?: number;
    }) {
      useComposerActiveFormatsPublish(
        onActiveFormatsChange,
        publishActiveFormats,
      );
      useLayoutEffect(() => {
        events.push("layout");
      }, []);
      return null;
    }

    // No subscriber yet: does not publish.
    const { rerender } = render(
      <Probe
        onActiveFormatsChange={undefined}
        publishActiveFormats={publishA}
        tick={0}
      />,
    );
    expect(publishA).not.toHaveBeenCalled();

    // Subscriber attaches: publishes in passive phase.
    events.length = 0;
    rerender(
      <Probe
        onActiveFormatsChange={listenerA}
        publishActiveFormats={publishA}
        tick={1}
      />,
    );
    expect(publishA).toHaveBeenCalledTimes(1);

    // Unrelated rerender with same references: does not republish.
    rerender(
      <Probe
        onActiveFormatsChange={listenerA}
        publishActiveFormats={publishA}
        tick={2}
      />,
    );
    expect(publishA).toHaveBeenCalledTimes(1);

    // Subscriber identity changes: republishes.
    rerender(
      <Probe
        onActiveFormatsChange={listenerB}
        publishActiveFormats={publishA}
        tick={3}
      />,
    );
    expect(publishA).toHaveBeenCalledTimes(2);

    // Publisher identity changes: republishes with the new publisher.
    rerender(
      <Probe
        onActiveFormatsChange={listenerB}
        publishActiveFormats={publishB}
        tick={4}
      />,
    );
    expect(publishB).toHaveBeenCalledTimes(1);

    // Subscriber detaches: does not publish.
    rerender(
      <Probe
        onActiveFormatsChange={undefined}
        publishActiveFormats={publishB}
        tick={5}
      />,
    );
    expect(publishB).toHaveBeenCalledTimes(1);
  });

  it("runs after mount layout effects and republishes on Activity reveal", () => {
    const order: string[] = [];
    const listener = vi.fn<(formats: ComposerActiveFormats) => void>();
    const publish = vi.fn(() => {
      order.push("publish");
    });

    function Probe() {
      useComposerActiveFormatsPublish(listener, publish);
      useLayoutEffect(() => {
        order.push("layout");
      }, []);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(order).toEqual(["layout", "publish"]);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(publish).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
