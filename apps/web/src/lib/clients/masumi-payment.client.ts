import "server-only";

import { createPaymentClient } from "@sokosumi/masumi/clients";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";

export const paymentClient = (() => {
  return createPaymentClient(
    getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
    getEnvSecrets().PAYMENT_API_URL,
    getEnvSecrets().PAYMENT_API_KEY,
  );
})();
