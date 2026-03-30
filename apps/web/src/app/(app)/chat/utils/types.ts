import type { CoworkerMetadata } from "@/lib/clients/generated/core/types.gen";

export type ChatStatus = "active" | "awaiting" | "resolved";

export interface Coworker {
  id: string;
  name: string;
  avatar?: string;
  caption?: string;
  description: string;
  useCase: string;
  slug: string;
  /** Present when mapped from API; used for contact channels on gallery cards. */
  metadata?: CoworkerMetadata | null;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: ChatStatus;
  coworker?: Coworker;
  model?: { id: string; name: string };
}
