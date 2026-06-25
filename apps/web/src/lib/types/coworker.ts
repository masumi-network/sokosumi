import type { Coworker } from "@/lib/clients/generated/core";
import type { TaskEventOrigin } from "@/lib/types/core-dto";

export interface CoworkerChannel {
  origin: TaskEventOrigin;
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
  description?: string;
  caption?: string;
  company?: string;
  companyLogo?: string;
  /** Sort/recommend weight — higher surfaces first. From `Coworker.priority`. */
  priority?: number;
  profile?: CoworkerProfile;
  /** Curated ready-to-run task offers shown in the New Task picker. */
  offers?: CoworkerOffer[];
}
