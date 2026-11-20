import type { Coworker } from "@sokosumi/core-client";
import type { CoworkerOffer } from "@/lib/types/coworker";
import { rankPageItems } from "@/lib/utils/page-search";

export interface OfferItem {
  offer: CoworkerOffer;
  coworker: Coworker;
}

interface VendorGroup {
  vendor: Coworker["vendor"];
  coworkers: Coworker[];
  offers: OfferItem[];
}

export function groupCoworkerSearchResults(
  coworkers: Coworker[],
  query: string,
): VendorGroup[] {
  const entries = coworkers.flatMap((coworker) => {
    const offers = coworker.metadata?.offers;
    return (offers?.length ? offers : [null]).map((offer) => ({
      coworker,
      offer,
    }));
  });
  const results = rankPageItems(entries, query, ({ coworker, offer }) => {
    const profile = coworker.metadata?.profile;
    return {
      primary: [coworker.name, offer?.title],
      secondary: [
        coworker.vendor.name,
        coworker.caption,
        coworker.description,
        profile?.hosting,
        ...(profile?.llm ?? []),
        ...(profile?.capabilities ?? []),
        ...(profile?.examples ?? []),
        offer?.category,
        offer?.description,
        offer?.deliverable,
      ],
    };
  });
  const vendors = new Map<string, VendorGroup>();
  const seen = new Set<string>();
  for (const { coworker, offer } of results) {
    const vendor = coworker.vendor;
    let group = vendors.get(vendor.id);
    if (!group) {
      group = { vendor, coworkers: [], offers: [] };
      vendors.set(vendor.id, group);
    }
    if (!seen.has(coworker.id)) {
      group.coworkers.push(coworker);
      seen.add(coworker.id);
    }
    if (offer) group.offers.push({ offer, coworker });
  }
  return Array.from(vendors.values());
}
