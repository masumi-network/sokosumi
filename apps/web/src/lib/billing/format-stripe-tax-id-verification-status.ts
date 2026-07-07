const STRIPE_TAX_ID_VERIFICATION_STATUS_KEYS = {
  pending: "taxIdVerificationStatus.pending",
  unavailable: "taxIdVerificationStatus.unavailable",
  unverified: "taxIdVerificationStatus.unverified",
  verification_failed: "taxIdVerificationStatus.verification_failed",
  verified: "taxIdVerificationStatus.verified",
} as const;

type BillingDetailsTranslator = (
  key: string,
  values?: { status?: string },
) => string;

export function formatStripeTaxIdVerificationStatus(
  t: BillingDetailsTranslator,
  status: string,
): string {
  const normalized = status.toLowerCase();
  const statusKey =
    STRIPE_TAX_ID_VERIFICATION_STATUS_KEYS[
      normalized as keyof typeof STRIPE_TAX_ID_VERIFICATION_STATUS_KEYS
    ];
  const statusLabel = statusKey ? t(statusKey) : status;

  return t("taxIdVerification", { status: statusLabel });
}
