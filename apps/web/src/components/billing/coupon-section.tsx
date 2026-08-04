import CouponForm from "@/components/credits/coupon-form";
import type { Organization } from "@/lib/clients/generated/core";

interface CouponSectionProps {
  organization: Organization | null;
  returnPath?: string;
}

export default async function CouponSection({
  organization,
  returnPath,
}: CouponSectionProps) {
  return <CouponForm organization={organization} returnPath={returnPath} />;
}
