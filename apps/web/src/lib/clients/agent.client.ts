import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createAgentClient } from "@sokosumi/masumi";

export const agentClient = (() => {
  return createAgentClient({
    onError: (error) => {
      const { type, operation, agentId, message, context } = error;

      // Add breadcrumb for fetchInputSchema operation
      if (operation === "fetchInputSchema") {
        Sentry.addBreadcrumb({
          category: "Agentic Service API",
          message: `Fetching input schema for agent: ${agentId}`,
          level: "info",
          data: context,
        });
      }

      Sentry.withScope((scope) => {
        scope.setTag("service", "agent");
        scope.setTag("operation", operation);
        scope.setTag("error_type", type);
        scope.setContext("error_details", context || {});

        if (type === "http_error") {
          const level =
            (context?.status as number) >= 500 ? "error" : "warning";
          Sentry.captureMessage(message, level);
        } else if (type === "json_parse_error") {
          Sentry.captureException(new Error(message), {
            contexts: {
              error_details: {
                message: "Failed to parse JSON response from agent API",
              },
            },
          });
        } else if (type === "schema_validation_error") {
          Sentry.captureMessage(message, "error");
        } else if (type === "network_error") {
          Sentry.captureException(new Error(message), {
            contexts: {
              error_details: {
                message:
                  "Network or unexpected error while fetching agent input schema",
              },
            },
          });
        }
      });
    },
  });
})();
