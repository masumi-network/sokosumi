import { describe, expect, it } from "vitest";

import { relayConnection } from "./relay-database";

const URL_WITH_MODE =
  "postgresql://relay:secret@proxy.rlwy.net:5432/railway?sslmode=require";

describe("relayConnection", () => {
  it("keeps the URL as it is without a root certificate", () => {
    expect(relayConnection(URL_WITH_MODE, undefined)).toEqual({
      connectionString: URL_WITH_MODE,
    });
  });

  it("trusts only the given root, drops sslmode, and reads escaped newlines", () => {
    const config = relayConnection(
      URL_WITH_MODE,
      "-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----",
    );
    expect(config.connectionString).toBe(
      "postgresql://relay:secret@proxy.rlwy.net:5432/railway",
    );
    const ssl = config.ssl as {
      ca: string;
      checkServerIdentity: () => undefined;
    };
    expect(ssl.ca).toBe(
      "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
    );
    // Railway names the server `localhost`; the root is what is checked.
    expect(ssl.checkServerIdentity()).toBeUndefined();
  });
});
