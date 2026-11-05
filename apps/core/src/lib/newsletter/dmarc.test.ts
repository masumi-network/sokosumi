import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasDmarcPolicy } from "./dmarc";

const m = vi.hoisted(() => ({ resolveTxt: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  Resolver: function Resolver() {
    return { resolveTxt: m.resolveTxt };
  },
}));

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("hasDmarcPolicy", () => {
  it("finds a policy on the sending domain", async () => {
    m.resolveTxt.mockResolvedValue([["v=DMARC1; p=none;"]]);
    await expect(hasDmarcPolicy("news.brand.example")).resolves.toBe(true);
    expect(m.resolveTxt).toHaveBeenCalledWith("_dmarc.news.brand.example");
  });

  it("falls back to the parent domain's policy, as receivers do", async () => {
    m.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "_dmarc.brand.example")
        return [["v=DMARC1; ", "p=quarantine"]];
      throw dnsError("ENOTFOUND");
    });
    await expect(hasDmarcPolicy("news.brand.example")).resolves.toBe(true);
  });

  it("reports missing when no domain up the tree has one", async () => {
    m.resolveTxt
      .mockRejectedValueOnce(dnsError("ENODATA"))
      .mockResolvedValueOnce([["google-site-verification=abc"]]);
    await expect(hasDmarcPolicy("news.brand.example")).resolves.toBe(false);
  });

  it("answers unknown when DNS fails", async () => {
    m.resolveTxt.mockRejectedValue(dnsError("ETIMEOUT"));
    await expect(hasDmarcPolicy("brand.example")).resolves.toBeNull();
  });
});
