import { buildFirstPartyCliOAuthClientWrite } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureFirstPartyCliOAuthClient } from "./first-party-cli-oauth-client";

const oauthClientUpsertMock = vi.fn();

describe("ensureFirstPartyCliOAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthClientUpsertMock.mockResolvedValue({ clientId: "sokosumi_cli" });
  });

  it("upserts the platform-owned native CLI client by stable client id", async () => {
    await expect(
      ensureFirstPartyCliOAuthClient({
        oauthClient: { upsert: oauthClientUpsertMock },
      }),
    ).resolves.toEqual({
      clientId: "sokosumi_cli",
    });

    const write = buildFirstPartyCliOAuthClientWrite();
    const { clientId, ...update } = write;
    expect(oauthClientUpsertMock).toHaveBeenCalledWith({
      where: { clientId },
      create: write,
      update,
    });
  });
});
