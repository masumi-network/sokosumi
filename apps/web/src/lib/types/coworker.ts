import type { TaskEventOrigin } from "@sokosumi/utils";

export interface CoworkerChannel {
  origin: TaskEventOrigin;
  value: string;
}

export interface CoworkerOption {
  id: string;
  slug: string;
  name: string;
  image: string;
  description?: string;
}
