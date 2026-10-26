import { NewsletterSubscriberStatus } from "@sokosumi/core-client";
import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const subscriberSearchParams = {
  search: parseAsString.withDefault(""),
  status: parseAsStringLiteral(Object.values(NewsletterSubscriberStatus)),
  cursor: parseAsString,
};

export const loadSubscriberSearchParams = createLoader(subscriberSearchParams);
