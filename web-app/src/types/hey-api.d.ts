import { GetPurchaseResponse } from "@/lib/api/generated/payment";

declare global {
  type PurchaseOnChainState =
    GetPurchaseResponse["data"]["Purchases"][number]["onChainState"];
  type PurchaseErrorType =
    | GetPurchaseResponse["data"]["Purchases"][number]["NextAction"]["errorType"]
    | null;
  type PurchaseNextAction =
    | GetPurchaseResponse["data"]["Purchases"][number]["NextAction"]["requestedAction"]
    | null;
  type Purchase = GetPurchaseResponse["data"]["Purchases"][number];

  type JobStatusResponse = GetJobStatusResponse["data"]["JobStatus"];
}
