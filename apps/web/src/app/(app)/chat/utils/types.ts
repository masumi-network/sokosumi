import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";

import type { CoworkerMetadata } from "@/lib/clients/generated/core/types.gen";

export type ChatStatus = "active" | "awaiting" | "resolved";
export type ChatComposeKind = "chat" | "task";
export type ChatSendMessage = Parameters<
  UseChatHelpers<UIMessage>["sendMessage"]
>[0];
export type ChatComposeMessage = string | ChatSendMessage;

export interface ChatComposeSubmitOptions {
  kind?: "chat";
  imageGeneration?: boolean;
}

export interface Coworker {
  id: string;
  name: string;
  avatar?: string;
  caption?: string;
  description: string;
  useCase: string;
  slug: string;
  /** Core list rank. Higher = more popular / earlier in pickers. */
  priority?: number;
  /** Assigned tasks with status COMPLETED, overall. */
  completedTaskCount?: number;
  capabilities?: Array<"chat" | "tasks">;
  archivedAt?: Date | string | null;
  isWhitelisted?: boolean;
  canChat?: boolean;
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
