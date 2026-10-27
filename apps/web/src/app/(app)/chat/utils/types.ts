import type { CoworkerMetadata } from "@sokosumi/core-client";

export type ChatComposeKind = "chat" | "task";

export interface Coworker {
  id: string;
  name: string;
  avatar?: string;
  caption?: string;
  description: string;
  useCase: string;
  slug: string;
  /** Core list rank. Higher = earlier in pickers / welcome strip. */
  priority?: number;
  capabilities?: Array<"chat" | "tasks">;
  archivedAt?: Date | string | null;
  isWhitelisted?: boolean;
  canChat?: boolean;
  /** Present when mapped from API; used for contact channels on gallery cards. */
  metadata?: CoworkerMetadata | null;
}
