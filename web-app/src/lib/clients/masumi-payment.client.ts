import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { postPurchaseResolveBlockchainIdentifier } from "@/lib/api/generated/payment";
import { createClient } from "@/lib/api/generated/payment/client";

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
  async getPurchaseForBlockchainIdentifier(
    blockchainIdentifier: string,
  ): Promise<Purchase | null> {
    try {
      const purchaseResponse = await postPurchaseResolveBlockchainIdentifier({
        client: client(),
        body: {
          blockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        },
      });
      if (!purchaseResponse.data) {
        return null;
      }
      return purchaseResponse.data.data;
    } catch {
      return null;
    }
  },
};
