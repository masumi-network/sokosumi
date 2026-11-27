import type { SocialPostProvider } from "@sokosumi/utils";
import type { CmoEvalBrand } from "../eval-cmo-cases";
import type { EvalSocialNetwork } from "../eval-social-accounts";

/** One page of a fictional brand's site, served on its `.example` domain. */
export interface CmoPathPage {
  /** The path on the brand's domain, `/` for the home page. */
  path: string;
  contentType: "text/html" | "image/svg+xml";
  body: string;
}

/** A mid-month owner change: what the owner says and which posts it must reach. */
export interface CmoPathChange {
  kind:
    | "drop-network"
    | "change-fact"
    | "move-post"
    | "add-piece"
    | "swap-format";
  message: string;
  /** The posts it affects, evaluated against the month before the turn. */
  selector: {
    network?: SocialPostProvider;
    /** A phrase in the copy, matched without case. */
    phrase?: string;
  };
  /** change-fact: the text every affected upcoming post must carry instead. */
  replacement?: string;
}

/**
 * The pattern planted in a brand's published posts for stage 5: one network
 * and format that clearly beats the rest, so a report can be checked for
 * finding it and for quoting only numbers that are there.
 */
export interface CmoPathAnalytics {
  winner: {
    network: SocialPostProvider;
    kinds: readonly ("image" | "video" | "carousel" | "text")[];
  };
  /** The winner's views and likes are this many times the others'. */
  factor: number;
  /** Words a report that found the winner uses (any of them). */
  winnerWords: readonly string[];
}

/** A fictional brand for the Cuso path test. Never a real company. */
export interface CmoPathBrand {
  id: string;
  /** Under the reserved `.example` TLD, so nothing can reach a real business. */
  domain: string;
  /** The fields the CMO suite's Brand Brain and strategy checks read. */
  eval: CmoEvalBrand;
  /** Facts the site states that the Brand Brain must carry, as patterns. */
  facts: readonly { label: string; pattern: string }[];
  /** The colours the site's CSS uses for the brand, as #rrggbb. */
  colors: readonly string[];
  owner: { firstName: string; lastName: string; timeZone: string };
  /** What the owner knows, for answering Cuso's yes/no questions. */
  ownerBrief: string;
  /** The networks the owner has connected (stand-in accounts). */
  networks: readonly EvalSocialNetwork[];
  pages: readonly CmoPathPage[];
  change: CmoPathChange;
  analytics: CmoPathAnalytics;
}
