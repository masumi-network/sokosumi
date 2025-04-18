import { GetPurchaseResponse } from "@/lib/api/generated/payment";

declare global {
  type PurchaseOnChainState =
    GetPurchaseResponse["data"]["Purchases"][number]["onChainState"];
}
