import { ApiKeysSection } from "./api-keys";
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
            docsContent={<DocsSection />}
          />
        </div>
      </div>
    </div>
  );
}
