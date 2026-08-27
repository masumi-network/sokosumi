import { describe, expect, it } from "vitest";

import { unlinkSocialAccountInput } from "./unlink-social-account";

describe("unlinkSocialAccountInput", () => {
  it("selects the local account row, not providerId", () => {
    expect(
      unlinkSocialAccountInput({
        id: "local-account-row-id",
      }),
    ).toEqual({
      accountId: "local-account-row-id",
    });
  });
});
