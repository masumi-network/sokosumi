import type { TaskEventOrigin } from "@sokosumi/database";

export interface CoworkerContactChannel {
  origin: TaskEventOrigin;
  value: string;
}

export interface CoworkerOption {
  id: string;
  name: string;
  image: string;
  description?: string;
  contacts: CoworkerContactChannel[];
}
