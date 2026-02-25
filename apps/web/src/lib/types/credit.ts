export type CreditsPrice = {
  cents: bigint;
};

export interface CreditUsage {
  hasUsageData: boolean;
  percentageUsed: number;
  remaining: number;
  total: number;
  used: number;
}
