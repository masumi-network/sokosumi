import { ComposioError } from "@composio/core";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

/** Shared by every integration route so they answer failures identically. */
export function mapIntegrationError(error: unknown): never {
  if (error instanceof ComposioError) {
    throw unprocessableEntity(`Composio: ${error.message}`);
  }
  if (error instanceof SokoBotIntegrationError) {
    if (error.kind === "NOT_CONFIGURED" || error.kind === "NOT_FOUND")
      throw notFound(error.message);
    if (error.kind === "UNKNOWN_PROVIDER") throw notFound(error.message);
    throw unprocessableEntity(error.message);
  }
  throw error;
}
