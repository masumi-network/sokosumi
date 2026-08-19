import { describe, expect, it, vi } from "vitest";

import {
  loadVisibleX402CatalogAgents,
  SHOW_X402_AGENTS_IN_CATALOG,
} from "@/lib/agents/x402-catalog-visibility";

describe("x402 catalog visibility", () => {
  it("keeps x402 API data out of catalog rendering and search without fetching it", async () => {
    const load = vi.fn().mockResolvedValue([{ id: "x402-agent" }]);

    expect(SHOW_X402_AGENTS_IN_CATALOG).toBe(false);
    await expect(loadVisibleX402CatalogAgents(load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
