import { describe, expect, it } from "vitest";

import {
  recordFqdn,
  relativeHost,
  sendingDomainFailureReason,
  sendingDomainOf,
  toNewsletterDnsRecords,
  toSendingDomainStatus,
  withDmarcRecord,
  zoneCandidates,
} from "./sending-domain";

describe("sending domain helpers", () => {
  it("takes the lowercased domain of a From address", () => {
    expect(sendingDomainOf("News@Brand.Example")).toBe("brand.example");
  });

  it.each([
    ["send", "brand.example", "send.brand.example"],
    ["resend._domainkey", "brand.example", "resend._domainkey.brand.example"],
    // Resend names a subdomain's records relative to the apex.
    ["send.news", "news.brand.example", "send.news.brand.example"],
    [
      "resend._domainkey.news",
      "news.brand.example",
      "resend._domainkey.news.brand.example",
    ],
    // …and the same answer if it ever names them relative to the domain.
    ["send", "news.brand.example", "send.news.brand.example"],
    ["send.send", "send.brand.example", "send.send.brand.example"],
    ["send.brand.example.", "brand.example", "send.brand.example"],
    ["@", "brand.example", "brand.example"],
  ])("qualifies %s under %s", (name, domain, fqdn) => {
    expect(recordFqdn(name, domain)).toBe(fqdn);
  });

  it("names a host relative to its zone", () => {
    expect(relativeHost("send.news.brand.example", "brand.example")).toBe(
      "send.news",
    );
    expect(relativeHost("brand.example", "brand.example")).toBe("@");
    expect(relativeHost("send.other.example", "brand.example")).toBeNull();
    expect(relativeHost("evilbrand.example", "brand.example")).toBeNull();
  });

  it("lists zones from the domain up to its parent", () => {
    expect(zoneCandidates("news.brand.example")).toEqual([
      "news.brand.example",
      "brand.example",
    ]);
    expect(zoneCandidates("brand.example")).toEqual(["brand.example"]);
  });

  it.each([
    ["verified", "VERIFIED"],
    ["failed", "FAILED"],
    ["partially_failed", "FAILED"],
    ["pending", "PENDING"],
    ["not_started", "PENDING"],
    ["partially_verified", "PENDING"],
  ] as const)("maps Resend %s to %s", (resend, status) => {
    expect(toSendingDomainStatus(resend)).toBe(status);
  });

  it("stores Resend records with qualified names", () => {
    expect(
      toNewsletterDnsRecords("news.brand.example", [
        {
          record: "SPF",
          type: "MX",
          name: "send.news",
          value: "feedback-smtp.eu-west-1.amazonses.com",
          ttl: "Auto",
          status: "pending",
          priority: 10,
        },
        {
          record: "DKIM",
          type: "TXT",
          name: "resend._domainkey.news",
          value: "p=KEY",
          ttl: "Auto",
          status: "verified",
        },
      ]),
    ).toEqual([
      {
        record: "SPF",
        type: "MX",
        name: "send.news.brand.example",
        value: "feedback-smtp.eu-west-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "pending",
      },
      {
        record: "DKIM",
        type: "TXT",
        name: "resend._domainkey.news.brand.example",
        value: "p=KEY",
        ttl: "Auto",
        priority: null,
        status: "verified",
      },
    ]);
  });

  it("names the failed records in the failure reason", () => {
    expect(
      sendingDomainFailureReason([
        {
          record: "DKIM",
          type: "TXT",
          name: "resend._domainkey.brand.example",
          value: "p=KEY",
          ttl: "Auto",
          priority: null,
          status: "failed",
        },
      ]),
    ).toContain("DKIM TXT resend._domainkey.brand.example");
    expect(sendingDomainFailureReason([])).toContain("could not verify");
  });

  describe("withDmarcRecord", () => {
    const RESEND = toNewsletterDnsRecords("news.brand.example", [
      {
        record: "DKIM",
        type: "TXT",
        name: "resend._domainkey.news",
        value: "p=KEY",
        ttl: "Auto",
        status: "pending",
      },
    ]);
    const SUGGESTED = {
      record: "DMARC",
      type: "TXT",
      name: "_dmarc.news.brand.example",
      value: "v=DMARC1; p=none;",
      ttl: "Auto",
      priority: null,
      status: "not_found",
    };

    it("suggests a p=none record when DMARC is missing", () => {
      expect(withDmarcRecord("news.brand.example", RESEND, [], false)).toEqual([
        ...RESEND,
        SUGGESTED,
      ]);
    });

    it("suggests nothing when a policy already exists", () => {
      expect(withDmarcRecord("news.brand.example", RESEND, [], true)).toEqual(
        RESEND,
      );
    });

    it("checks off a suggestion once the policy is published", () => {
      expect(
        withDmarcRecord("news.brand.example", RESEND, [SUGGESTED], true),
      ).toEqual([...RESEND, { ...SUGGESTED, status: "verified" }]);
    });

    it("keeps the previous suggestion when DNS cannot answer", () => {
      expect(
        withDmarcRecord("news.brand.example", RESEND, [SUGGESTED], null),
      ).toEqual([...RESEND, SUGGESTED]);
      expect(withDmarcRecord("news.brand.example", RESEND, [], null)).toEqual(
        RESEND,
      );
    });
  });
});
