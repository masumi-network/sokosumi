import CreditsSection from "@/components/billing/credits-section";
import { userService } from "@/lib/services";

interface CreditsPageProps {
  searchParams: Promise<{
    session_id?: string;
    cancel?: string;
  }>;
}

export default async function CreditsPage({ searchParams }: CreditsPageProps) {
  const { session_id, cancel } = await searchParams;
  const activeOrganization = await userService.getActiveOrganization();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <CreditsSection
          organization={activeOrganization}
          returnPath="/credits"
          searchParams={{ cancel, session_id }}
        />
      </div>
    </div>
  );
}
