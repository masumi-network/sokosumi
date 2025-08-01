import "server-only";

import { getEnvSecrets } from "@/config/env.secrets";
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

export const paymentClient = {};
