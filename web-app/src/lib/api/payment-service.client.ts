import { createClient } from "@hey-api/client-next";

import { getEnvSecrets } from "@/config/env.secrets";
import type { Client as PaymentClient } from "@/lib/api/generated/payment/client/types";

export const getPaymentClient = (): PaymentClient => {
  const paymentClient = createClient({
    baseUrl: getEnvSecrets().PAYMENT_API_URL,
  });
  paymentClient.setConfig({
    headers: { token: getEnvSecrets().PAYMENT_API_KEY },
  });
  return paymentClient as PaymentClient;
};
