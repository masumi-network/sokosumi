import { Suspense } from "react";

import { vendorService } from "@/lib/services/vendor.service";

import { ApiKeysSection } from "./api-keys";
import { DeveloperCoworkersSection } from "./coworkers";
import { DeveloperTabs } from "./developer-tabs";
import { DocsSection } from "./docs-section";
import { OAuthClientsSection } from "./oauth-clients";
import { DeveloperTasksSection } from "./tasks";
import { DeveloperVendorsSection } from "./vendors";

export async function DeveloperPage() {
  const adminVendors = await vendorService
    .listMyAdminVendorMemberships()
    .catch(() => []);
  const showVendorsTab = adminVendors.length > 0;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <div className="space-y-6">
          <DeveloperTabs
            showVendorsTab={showVendorsTab}
            oauthClientsContent={<OAuthClientsSection />}
            apiKeysContent={<ApiKeysSection />}
            coworkersContent={
              <Suspense fallback={null}>
                <DeveloperCoworkersSection />
              </Suspense>
            }
            tasksContent={
              <Suspense fallback={null}>
                <DeveloperTasksSection />
              </Suspense>
            }
            vendorsContent={
              <Suspense fallback={null}>
                <DeveloperVendorsSection adminVendors={adminVendors} />
              </Suspense>
            }
            docsContent={
              <Suspense fallback={null}>
                <DocsSection />
              </Suspense>
            }
          />
        </div>
      </div>
    </div>
  );
}
