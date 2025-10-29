import { GetPurchaseResponse } from "@/lib/clients/generated/payment";

declare global {
  type PurchaseOnChainState =
    GetPurchaseResponse["data"]["Purchases"][number]["onChainState"];
  type PurchaseErrorType =
    | GetPurchaseResponse["data"]["Purchases"][number]["NextAction"]["errorType"]
    | null;
  type PurchaseNextAction =
    GetPurchaseResponse["data"]["Purchases"][number]["NextAction"];
  type PurchaseRequestedAction =
    GetPurchaseResponse["data"]["Purchases"][number]["NextAction"]["requestedAction"];
  type Purchase = GetPurchaseResponse["data"]["Purchases"][number];

  type JobStatusResponse = GetJobStatusResponse["data"]["JobStatus"];
  type CurrentTransactionStatus =
    GetPurchaseResponse["data"]["Purchases"][number]["CurrentTransaction"]["status"];
}
