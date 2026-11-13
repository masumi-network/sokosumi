import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  cmoBilling,
  cmoStrategyVersion,
  cmoOverview as overview,
} from "../test-fixtures/cmo";
import { OutOfCreditsBanner } from "./app/cmo-app";
import { SettingsPage } from "./app/pages";
import { UpNext } from "./app/up-next";
import { Refusal } from "./onboarding/refusal";
import { type StartTopUp, topUpOffer } from "./top-up";

const startTopUp: StartTopUp = async () => ({ url: null, error: null });
const noCredits = cmoBilling({ availableCredits: 0 });

describe("topUpOffer", () => {
  it("offers the top-up for a Cuso with an active subscription", () => {
    expect(
      topUpOffer(
        overview({ billing: cmoBilling({ status: "active" }) }),
        startTopUp,
      ),
    ).toBe(startTopUp);
  });

  it("offers none for a Cuso without one", () => {
    expect(
      topUpOffer(
        overview({ billing: cmoBilling({ status: "past_due" }) }),
        startTopUp,
      ),
    ).toBeNull();
  });
});

describe("the out-of-credits banner", () => {
  it("offers the top-up", () => {
    const html = renderToStaticMarkup(
      <OutOfCreditsBanner topUp={startTopUp} />,
    );
    expect(html).toContain("out of credits");
    expect(html).toContain(">Top up</button>");
    expect(html).not.toContain("href=");
  });

  it("says he is paused without a top-up for an unsubscribed Cuso", () => {
    const html = renderToStaticMarkup(<OutOfCreditsBanner topUp={null} />);
    expect(html).toContain("out of credits");
    expect(html).not.toMatch(/top up/i);
  });
});

describe("the paused Up next", () => {
  const upNext = (
    patch: Parameters<typeof overview>[0],
    topUp: StartTopUp | null,
  ) =>
    renderToStaticMarkup(
      <UpNext
        overview={overview({
          ...cmoStrategyVersion(new Date()),
          ...patch,
        })}
        today="2026-11-13"
        compose={() => {}}
        pause={async () => {}}
        close={() => {}}
        topUp={topUp}
      />,
    );

  it("offers the top-up when credits ran out", () => {
    const html = upNext({ billing: noCredits }, startTopUp);
    expect(html).toContain("Paused: out of credits");
    expect(html).toContain(">Top up</button>");
  });

  it("offers none for an unsubscribed Cuso", () => {
    const html = upNext({ billing: noCredits }, null);
    expect(html).not.toContain("Top up");
  });

  it("marks his work paused without a paid CMO plan, credits or not", () => {
    const upNextItems = [
      {
        id: "entry-1",
        date: "2026-11-14",
        channel: "linkedin",
        title: "Launch post",
        status: "planned",
      },
    ];
    const working = upNext({ upNext: upNextItems }, startTopUp);
    const paused = upNext(
      { upNext: upNextItems, subscriptionActive: false },
      startTopUp,
    );
    expect(working).not.toContain(">Paused<");
    expect(paused).toContain(">Paused<");
    expect(paused).not.toContain("Top up");
  });

  it("offers none while credits are left", () => {
    const html = upNext({}, startTopUp);
    expect(html).not.toContain("Top up");
    expect(html).not.toContain("Paused");
  });
});

describe("a refusal", () => {
  it("offers the top-up when credits ran out", () => {
    const html = renderToStaticMarkup(
      <Refusal text="You're out of credits" topUp={startTopUp} />,
    );
    expect(html).toContain("You&#x27;re out of credits.");
    expect(html).toContain(">Top up</button>");
    expect(html).not.toContain("Sokosumi");
    expect(html).not.toContain("href=");
  });

  it("offers none for an unsubscribed Cuso", () => {
    const html = renderToStaticMarkup(
      <Refusal text="You're out of credits" topUp={null} />,
    );
    expect(html).toContain("You&#x27;re out of credits.");
    expect(html).not.toMatch(/top up/i);
  });

  it("shows any other reason as it is", () => {
    const html = renderToStaticMarkup(
      <Refusal text="Cuso is busy" topUp={startTopUp} />,
    );
    expect(html).toContain("Cuso is busy");
    expect(html).not.toContain("Top up");
  });
});

describe("Settings", () => {
  const settings = (topUp: StartTopUp | null) =>
    renderToStaticMarkup(
      <SettingsPage
        overview={overview()}
        compose={() => {}}
        name="Ada"
        email="ada@example.com"
        startOver={async () => null}
        signOut={async () => {}}
        topUp={topUp}
        plans={[]}
        changePlan={async () => ({ change: null, error: null })}
        openPortal={async () => ({ url: null, error: null })}
        subscribe={startTopUp}
      />,
    );

  it("offers the top-up beside the credits", () => {
    const html = settings(startTopUp);
    expect(html).toContain("credits available");
    expect(html).toContain(">Top up</button>");
    expect(html).not.toContain("/billing");
  });

  it("shows the credits without a top-up for an unsubscribed Cuso", () => {
    const html = settings(null);
    expect(html).toContain("credits available");
    expect(html).not.toContain("Top up");
  });
});
