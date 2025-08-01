import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  getPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "@/lib/api/generated/payment";
import { createClient } from "@/lib/api/generated/payment/client";
import { Err, Ok, Result } from "@/lib/ts-res";

const client = () => {
  const paymentClient = createClient({
    baseUrl: getEnvSecrets().PAYMENT_API_URL,
  });
  paymentClient.setConfig({
    headers: { token: getEnvSecrets().PAYMENT_API_KEY },
  });
  return paymentClient;
};

export const paymentClient = {
  async getPurchaseByBlockchainIdentifier(
    blockchainIdentifier: string,
  ): Promise<Purchase | null> {
    try {
      const response = await postPurchaseResolveBlockchainIdentifier({
        client: client(),
        body: {
          blockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        },
      });
      if (!response.data) {
        return null;
      }
      return response.data.data;
    } catch {
      return null;
    }
  },

  async getPurchaseById(purchaseId: string): Promise<Result<Purchase, string>> {
    try {
      const response = await getPurchase({
        client: client(),
        query: {
          cursorId: purchaseId,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          limit: 1,
        },
      });

      if (
        response.error ||
        !response.data ||
        response.data.data.Purchases.length != 1
      ) {
        return Err(response.error ? String(response.error) : "Unknown error");
      }
      const purchase = response.data.data.Purchases[0];

      return Ok(purchase);
    } catch (err) {
      return Err(String(err));
    }
  },

  async requestRefund(
    jobBlockchainIdentifier: string,
  ): Promise<Result<void, string>> {
    try {
      const response = await postPurchaseRequestRefund({
        client: client(),
        body: {
          blockchainIdentifier: jobBlockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        },
      });

      if (response.error || !response.data) {
        return Err("Failed to request refund");
      }

      return Ok();
    } catch (err) {
      return Err(String(err));
    }
  },
};
