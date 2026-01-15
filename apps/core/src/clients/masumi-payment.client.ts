import { createPaymentClient } from "@sokosumi/masumi/clients";

import { getEnv } from "@/config/env";

export const paymentClient = (() => {
  const client = () =>
    createPaymentClient(
      getEnv().NETWORK,
      getEnv().PAYMENT_API_URL,
      getEnv().PAYMENT_API_KEY,
    );
  return client;
})();
