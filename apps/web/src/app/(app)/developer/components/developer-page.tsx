import { Suspense } from "react";

import { ApiKeysSection } from "./api-keys";
import { DeveloperCoworkersSection } from "./coworkers";
import { DeveloperTabs } from "./developer-tabs";
import { DocsSection } from "./docs-section";
import { OAuthClientsSection } from "./oauth-clients";

export function DeveloperPage() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <div className="space-y-6">
          <DeveloperTabs
            oauthClientsContent={<OAuthClientsSection />}
            apiKeysContent={<ApiKeysSection />}
            coworkersContent={
              <Suspense fallback={null}>
                <DeveloperCoworkersSection />
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
