import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { formatDaySeparator } from "@/app/chat/utils/date-utils";

import DaySeparator from "../day-separator";

/**
 * Repro for SOKOSUMI-A on chat rooms: SSR (UTC) used to emit a local-calendar
 * day label that disagreed with the browser TZ on hydrate (Today vs Thursday).
 * DaySeparator must stay hydration-stable across TZ.
 */
describe("DaySeparator hydration (SOKOSUMI-A)", () => {
  const previousTz = process.env.TZ;
  const recoverable: string[] = [];

  afterEach(() => {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
    recoverable.length = 0;
    document.body.innerHTML = "";
  });

  it("SSR UTC HTML must hydrate under Europe/Berlin without recoverable hydration errors", async () => {
    const evening = new Date("2026-08-05T22:30:00.000Z");

    process.env.TZ = "UTC";
    const ssrHtml = renderToString(
      <DaySeparator date={evening} formatDaySeparator={formatDaySeparator} />,
    );

    process.env.TZ = "Europe/Berlin";
    document.body.innerHTML = `<div id="root">${ssrHtml}</div>`;

    await act(async () => {
      hydrateRoot(
        document.getElementById("root")!,
        <DaySeparator date={evening} formatDaySeparator={formatDaySeparator} />,
        {
          onRecoverableError(error) {
            recoverable.push(String(error));
          },
        },
      );
    });

    expect(
      recoverable.filter((msg) => /hydrat|match|server/i.test(msg)),
      recoverable.join("\n---\n"),
    ).toEqual([]);
  });
});
