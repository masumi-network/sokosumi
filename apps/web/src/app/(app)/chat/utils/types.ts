export type ChatStatus = "active" | "awaiting" | "resolved";

export interface Coworker {
  id: string;
  name: string;
  avatar?: string;
  caption?: string;
  description: string;
  useCase: string;
  slug: string;
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
