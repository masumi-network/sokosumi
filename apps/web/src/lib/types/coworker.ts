import type { TaskEventOrigin } from "@sokosumi/database";

export interface CoworkerChannel {
  origin: TaskEventOrigin;
  value: string;
}

export interface CoworkerOption {
  id: string;
  name: string;
  image: string;
  description?: string;
}
