import { createClient } from "@hey-api/client-next";

import { getEnvSecrets } from "@/config/env.secrets";

export const getPaymentClient = () => {
  const paymentClient = createClient({
    baseUrl: getEnvSecrets().PAYMENT_API_URL,
  });
  paymentClient.setConfig({
    headers: { token: getEnvSecrets().PAYMENT_API_KEY },
  });
  return paymentClient;
};
