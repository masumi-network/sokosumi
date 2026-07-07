export interface StripeBillingAddressLike {
  country: string;
}

export function hasStripeBillingAddressWithCountry(
  address: StripeBillingAddressLike | null | undefined,
): boolean {
  return (address?.country?.trim().length ?? 0) > 0;
}
