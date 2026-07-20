import { ApiKeysSection } from "./api-keys-section";
import { DeveloperDocsHeader } from "./developer-docs-header";
import { DeveloperTabs } from "./developer-tabs";
import { OAuthClientsSection } from "./oauth-clients-section";

export async function DeveloperPage() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <DeveloperDocsHeader />
        <DeveloperTabs
          oauthClientsContent={<OAuthClientsSection />}
          apiKeysContent={<ApiKeysSection />}
        />
      </div>
    </div>
  );
}
