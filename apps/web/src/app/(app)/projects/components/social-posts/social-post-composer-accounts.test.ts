import { describe, expect, it } from "vitest";
import {
  composerAccountsStorageKey,
  initialCreateConnectionIds,
} from "./social-post-composer-accounts";

function account(id: string, status: "active" | "disconnected" = "active") {
  return { id, status };
}

describe("social-post-composer-accounts", () => {
  it("keys the preference by workspace and project", () => {
    expect(composerAccountsStorageKey("org_1", "project-1")).toBe(
      "sokosumi.social-composer.accounts.v1:org_1:project-1",
    );
  });

  it("keeps remembered ids that are still connected", () => {
    expect(
      initialCreateConnectionIds(
        [account("connection-1"), account("connection-2")],
        ["connection-2", "connection-1"],
      ),
    ).toEqual(["connection-2", "connection-1"]);
  });

  it("drops a disconnected remembered account", () => {
    expect(
      initialCreateConnectionIds(
        [account("connection-1"), account("connection-2", "disconnected")],
        ["connection-1", "connection-2"],
      ),
    ).toEqual(["connection-1"]);
  });

  it("falls back to the first account when nothing remembered still connects", () => {
    expect(
      initialCreateConnectionIds(
        [account("connection-1"), account("connection-2")],
        ["gone"],
      ),
    ).toEqual(["connection-1"]);
    expect(
      initialCreateConnectionIds(
        [account("connection-1"), account("connection-2")],
        null,
      ),
    ).toEqual(["connection-1"]);
  });
});
