import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AGENT_NAME } from "../../lib/agent";
import { cmoBilling, cmoOverview } from "../../test-fixtures/cmo";
import { cmoPause, PausedBanner } from "./paused";

const subscribe = async () => ({ url: null, error: null });
const openPortal = async () => ({ url: null, error: null });

function banner(billing: Parameters<typeof cmoBilling>[0]) {
  const overview = cmoOverview({
    subscriptionActive: false,
    billing: cmoBilling(billing),
  });
  const pause = cmoPause(overview);
  return pause
    ? renderToStaticMarkup(
        <PausedBanner
          pause={pause}
          billing={overview.billing}
          subscribe={subscribe}
          openPortal={openPortal}
        />,
      )
    : "";
}

describe("cmoPause", () => {
  it("is null while Cuso may work", () => {
    expect(cmoPause(cmoOverview({ subscriptionActive: true }))).toBeNull();
  });

  it("asks for a plan when the Project has none", () => {
    expect(
      cmoPause(
        cmoOverview({ subscriptionActive: false, billing: cmoBilling() }),
      ),
    ).toBe("subscribe");
  });

  it("asks to fix the payment while it is past due", () => {
    expect(
      cmoPause(
        cmoOverview({
          subscriptionActive: false,
          billing: cmoBilling({ status: "past_due", tier: "growth" }),
        }),
      ),
    ).toBe("fixPayment");
  });
});

describe("the paused banner", () => {
  it("says why and offers the plan checkout without a subscription", () => {
    const html = banner({});
    expect(html).toContain(`${AGENT_NAME} is paused`);
    expect(html).toContain("no CMO plan");
    expect(html).toContain(">Subscribe</button>");
    expect(html).not.toMatch(/top up/i);
  });

  it("names the failed payment and offers an owner or admin the fix", () => {
    const html = banner({
      status: "past_due",
      tier: "growth",
      viewerCanManage: true,
    });
    expect(html).toContain("last payment failed");
    expect(html).toContain(">Fix payment</button>");
    expect(html).not.toContain(">Subscribe</button>");
  });

  it("tells another member who fixes the payment", () => {
    const html = banner({
      status: "past_due",
      tier: "growth",
      viewerCanManage: false,
    });
    expect(html).toContain("last payment failed");
    expect(html).toContain("owner or admin");
    expect(html).not.toContain("</button>");
  });
});
