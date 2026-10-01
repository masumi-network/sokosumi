import { PutAdMarketProfileRequestSchema } from "@sokosumi/core-client/schemas";

const { keywords } = PutAdMarketProfileRequestSchema.properties;

/** How many keywords a market profile holds, and how long each can be: Core's. */
export const MARKET_KEYWORD_LIMIT = keywords.maxItems;
export const MARKET_KEYWORD_MAX_LENGTH = keywords.items.maxLength;
