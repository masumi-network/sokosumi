import { expect, it } from "vitest";

import { transactionHistoryKinds } from "@/schemas/transaction-history.schema";
import apiV1 from "./index";

it("requires the Network on credit responses and the balance effect on every ledger item", () => {
  const doc = apiV1.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Sokosumi API", version: "1.0.0" },
  });
  const requiresNetwork = expect.arrayContaining(["network"]);
  for (const path of [
    "/users/{id}/credits",
    "/users/{id}/organizations/{organizationId}/credits",
  ]) {
    expect(doc.paths?.[path]?.get?.responses?.["200"], path).toHaveProperty(
      [
        "content",
        "application/json",
        "schema",
        "properties",
        "data",
        "required",
      ],
      requiresNetwork,
    );
  }

  const schemas = doc.components?.schemas;
  expect(schemas?.TransactionTotal).toHaveProperty("required", requiresNetwork);
  expect(schemas?.TransactionDailySpendList).toHaveProperty(
    "items.required",
    requiresNetwork,
  );

  const history = schemas?.TransactionHistoryItem as {
    oneOf: { $ref: string }[];
  };
  expect(history.oneOf).toHaveLength(transactionHistoryKinds.length);
  for (const { $ref } of history.oneOf) {
    const name = $ref.replace("#/components/schemas/", "");
    expect(schemas?.[name], name).toHaveProperty(
      "required",
      expect.arrayContaining(["network", "affectsBalance"]),
    );
  }
});
