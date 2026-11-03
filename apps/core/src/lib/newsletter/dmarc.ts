import { Resolver } from "node:dns/promises";

import { zoneCandidates } from "./sending-domain";

const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA"]);

/**
 * Whether `domain` has a DMARC policy at `_dmarc.<domain>` or, as receivers
 * fall back to, at a parent domain. `null` when DNS could not answer.
 */
export async function hasDmarcPolicy(domain: string): Promise<boolean | null> {
  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  for (const zone of zoneCandidates(domain)) {
    try {
      const records = await resolver.resolveTxt(`_dmarc.${zone}`);
      if (records.some((chunks) => /^v=DMARC1\b/i.test(chunks.join("")))) {
        return true;
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code !== "string" || !NO_RECORD_CODES.has(code)) return null;
    }
  }
  return false;
}
