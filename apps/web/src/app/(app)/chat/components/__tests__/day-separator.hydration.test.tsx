import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { messageDayKey } from "@/app/chat/components/room-helpers";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";

import DaySeparator from "../day-separator";

/**
 * Repro for SOKOSUMI-A on chat rooms: SSR (UTC) emits a day separator tree /
 * label that does not match the browser's local calendar on hydrate.
 */
function RoomDaySlice({ iso }: { iso: string }) {
  return (
    <div data-testid="day-slice">
      <DaySeparator
        date={new Date(iso)}
        formatDaySeparator={formatDaySeparator}
      />
      <span data-day-key={messageDayKey(iso)} />
    </div>
  );
}

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
    const evening = "2026-08-05T22:30:00.000Z";

    process.env.TZ = "UTC";
    const ssrHtml = renderToString(<RoomDaySlice iso={evening} />);

    process.env.TZ = "Europe/Berlin";
    document.body.innerHTML = `<div id="root">${ssrHtml}</div>`;

    await act(async () => {
      hydrateRoot(
        document.getElementById("root")!,
        <RoomDaySlice iso={evening} />,
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
