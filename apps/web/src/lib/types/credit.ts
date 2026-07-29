export type CreditsPrice = {
  cents: bigint;
};

export interface CreditUsage {
  percentageUsed: number;
  remaining: number;
  total: number;
  used: number;
}
