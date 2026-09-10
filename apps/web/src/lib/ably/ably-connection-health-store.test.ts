import { beforeEach, describe, expect, it } from "vitest";

import {
  getAblyConnectionHealthy,
  reportAblyAuthOk,
  reportAblyConnectionConnected,
  setAblyConnectionHealthy,
} from "./ably-connection-health-store";

describe("ably connection health store", () => {
  beforeEach(() => {
    setAblyConnectionHealthy(false);
  });

  it("is unhealthy until both the socket is connected and auth has succeeded", () => {
    expect(getAblyConnectionHealthy()).toBe(false);

    reportAblyConnectionConnected(true);
    expect(getAblyConnectionHealthy()).toBe(false);

    reportAblyAuthOk(true);
    expect(getAblyConnectionHealthy()).toBe(true);
  });

  it("goes unhealthy on an auth failure while the socket stays connected", () => {
    reportAblyConnectionConnected(true);
    reportAblyAuthOk(true);
    expect(getAblyConnectionHealthy()).toBe(true);

    reportAblyAuthOk(false);
    expect(getAblyConnectionHealthy()).toBe(false);
  });

  it("goes unhealthy when the socket drops after a successful auth", () => {
    reportAblyConnectionConnected(true);
    reportAblyAuthOk(true);

    reportAblyConnectionConnected(false);
    expect(getAblyConnectionHealthy()).toBe(false);
  });
});
