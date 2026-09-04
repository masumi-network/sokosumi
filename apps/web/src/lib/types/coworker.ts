import type { Coworker, Vendor } from "@/lib/clients/generated/core";
import type { Channel } from "@/lib/types/core-dto";

export interface CoworkerChannel {
  channel: Channel;
  value: string;
}

/** A coworker's curated, pre-filled task offer (from the Core Coworker DTO). */
export type CoworkerOffer = NonNullable<
  NonNullable<Coworker["metadata"]>["offers"]
>[number];

export interface CoworkerProfile {
  llm?: string[];
  hosting?: string;
  capabilities?: string[];
  examples?: string[];
}

export interface CoworkerOption {
  id: string;
  slug: string;
  name: string;
  image: string;
  /**
   * Marketplace coworker by default. Owner personal assistant is
   * `orchestrator`. Workspace members are `user`. Unset is represented by
   * an empty selection, not an option.
   */
  kind?: "coworker" | "orchestrator" | "user";
  /** Present for orchestrator options without a claimed mascot. */
  avatarSeed?: string | null;
  description?: string;
  caption?: string;
  vendor: Pick<Vendor, "id" | "name" | "slug" | "logos">;
  /** Sort/recommend weight — higher surfaces first. From `Coworker.priority`. */
  priority?: number;
  profile?: CoworkerProfile;
  /** Curated ready-to-run task offers shown in the New Task picker. */
  offers?: CoworkerOffer[];
}
