import CouponSection from "@/components/billing/coupon-section";
import { getFeaturedCoworkers } from "@/components/billing/get-featured-coworkers";
import { userService } from "@/lib/services";

interface CouponPageProps {
  searchParams: Promise<{
    session_id?: string;
    cancel?: string;
  }>;
}

export default async function CouponPage({ searchParams }: CouponPageProps) {
  const { session_id, cancel } = await searchParams;
  const activeOrganization = await userService.getActiveOrganization();
  const coworkersPromise = getFeaturedCoworkers();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <CouponSection
          coworkersPromise={coworkersPromise}
          organization={activeOrganization}
          returnPath="/coupon"
          searchParams={{ cancel, session_id }}
        />
      </div>
    </div>
  );
}
