"use server";

import { Err, Ok, Result } from "ts-res";

import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { AgentWithRelations, getAgentApiBaseUrl } from "@/lib/db";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";
import { Agent } from "@/prisma/generated/client";

export async function fetchAgentInputSchema(
  agent: AgentWithRelations,
): Promise<Result<JobInputsDataSchemaType, string>> {
  try {
    const baseUrl = getAgentApiBaseUrl(agent);
    const inputSchemaUrl = new URL(`/input_schema`, baseUrl);

    const response = await fetch(inputSchemaUrl);
    if (!response.ok) {
      return Err(response.statusText);
    }

    const parsedResult = jobInputsDataSchema().safeParse(await response.json());
    if (!parsedResult.success) {
      return Err("Failed to parse input schema");
    }
    const inputSchema = parsedResult.data;
    return Ok(inputSchema);
  } catch (err) {
    return Err(String(err));
  }
}

interface FixedPricing {
  pricingType: "Fixed";
  FixedPricing: {
    Amounts: Array<{
      amount: string;
      unit: string;
    }>;
  };
}
export async function getAgentPaymentInformation(
  agent: Agent,
): Promise<Result<FixedPricing, string>> {
  try {
    const registryClient = getRegistryClient();

    const paymentInformation = await getPaymentInformation({
      client: registryClient,
      query: {
        agentIdentifier: agent.blockchainIdentifier,
      },
    });

    if (
      !paymentInformation ||
      !paymentInformation.data ||
      !paymentInformation.data.data
    ) {
      return Err("Payment information not found or invalid price");
    }
    return Ok(paymentInformation.data.data.AgentPricing);
  } catch (err) {
    return Err(String(err));
  }
}
