import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  readSeoConnectionCallback,
  SEO_CONNECTION_HANDOFF_PREFIX,
  type SeoConnectionCallbackContext,
} from "@/lib/seo/connection-callback";
import { useSeoConnectionHandoff } from "./use-seo-connection-handoff";

describe("useSeoConnectionHandoff", () => {
  afterEach(() => {
    window.name = "";
  });

  it("reads and clears window.name once, surviving StrictMode replay", () => {
    const expected = readSeoConnectionCallback(
      new URLSearchParams({
        provider: "ga4",
        viewer: "owner",
        organization: "org",
        auditId: "687d2470-7c63-4779-b10c-462d24ac1e1b",
        session_uri: "one-use",
      }),
    );
    window.name = SEO_CONNECTION_HANDOFF_PREFIX + JSON.stringify(expected);

    let seen: SeoConnectionCallbackContext | null | undefined;
    function Probe() {
      seen = useSeoConnectionHandoff();
      return null;
    }

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    expect(seen).toEqual(expected);
    expect(window.name).toBe("");
  });

  it("returns undefined during SSR and null when window.name has no handoff", () => {
    window.name = "";
    let seen: SeoConnectionCallbackContext | null | undefined;
    function Probe() {
      seen = useSeoConnectionHandoff();
      return <span>{seen === undefined ? "loading" : "done"}</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>loading</span>");
    render(<Probe />);
    expect(seen).toBeNull();
  });
});
