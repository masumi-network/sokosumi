import type { TaskEventOrigin } from "@sokosumi/database";

export interface CoworkerChannel {
  origin: TaskEventOrigin;
  value: string;
}

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
}
