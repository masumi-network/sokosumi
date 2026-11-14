import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";
import type { ComposioIntegrationAccount } from "@/services/composio-integration-tools.service";
import type {
  ActiveIntegration,
  SokoBotIntegrationCatalogEntry,
} from "@/services/soko-bot-integrations.service";
import {
  currentMailboxFixture,
  type MailboxFixtureBinding,
} from "./mailbox-binding";
import { executeMailboxFixture } from "./mailbox-provider-fixtures";

const FIXTURE_ACCOUNT_PREFIX = "eval-mailbox:";
const FIXTURE_PROVIDERS = ["gmail", "googlecalendar"] as const;
const FIXTURE_DENIED =
  "Mailbox evaluation fixture scope or operation is not allowed";

function fixtureAccountId(
  binding: MailboxFixtureBinding,
  providerId: string,
): string {
  return `${FIXTURE_ACCOUNT_PREFIX}${binding.resultId}:${binding.sokoBotId}:${providerId}`;
}

/** A reserved reference must never fall through to real provider execution. */
export function isMailboxFixtureAccount(integration: {
  id?: string;
  composioAccountId: string;
}): boolean {
  return (
    integration.composioAccountId.startsWith(FIXTURE_ACCOUNT_PREFIX) ||
    (integration.id?.startsWith(FIXTURE_ACCOUNT_PREFIX) ?? false)
  );
}

/** Virtual accounts exist only inside one currently validated evaluation actor. */
export async function mailboxFixtureIntegrations(
  sokoBotId?: string,
  kind?: "email" | "calendar" | "generic",
  providerId?: string,
): Promise<ActiveIntegration[] | null> {
  const binding = await currentMailboxFixture(sokoBotId);
  if (!binding) return null;
  if (kind === "generic") return [];
  return FIXTURE_PROVIDERS.flatMap((id) => {
    const provider = getSokoBotIntegrationProvider(id);
    if (!provider) throw new Error(FIXTURE_DENIED);
    if (
      (providerId && provider.id !== providerId) ||
      (kind && !provider.kinds.includes(kind))
    )
      return [];
    const accountId = fixtureAccountId(binding, provider.id);
    return [
      {
        id: accountId,
        sokoBotId: binding.sokoBotId,
        provider,
        composioAccountId: accountId,
        connectorUserId: binding.userId,
        cursor: null,
      },
    ];
  });
}

/** Fixture discovery never consults the live Composio catalog or its cache. */
export async function mailboxFixtureCatalog(
  query: string,
  limit: number,
): Promise<SokoBotIntegrationCatalogEntry[] | null> {
  const integrations = await mailboxFixtureIntegrations();
  if (!integrations) return null;
  const needle = query.trim().toLowerCase();
  return integrations
    .filter(
      ({ provider }) =>
        !needle ||
        `${provider.id} ${provider.name}`.toLowerCase().includes(needle),
    )
    .slice(0, limit)
    .map(({ provider }) => ({
      provider: provider.id,
      name: provider.name,
      description: null,
      logoUrl: provider.logoUrl,
      kinds: provider.kinds,
    }));
}

/** Discovery and generic tools are not a route around dedicated fixture reads. */
export async function refuseMailboxFixtureGenericTool(
  integration: ComposioIntegrationAccount,
): Promise<void> {
  const binding = await currentMailboxFixture();
  if (binding || isMailboxFixtureAccount(integration))
    throw new Error(FIXTURE_DENIED);
}

/** Validate the persisted binding again immediately before every fixture read. */
export async function executeMailboxFixtureTool(
  integration: ComposioIntegrationAccount,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const binding = await currentMailboxFixture();
  if (!binding && !isMailboxFixtureAccount(integration)) return null;
  if (!binding) throw new Error(FIXTURE_DENIED);
  const provider = getSokoBotIntegrationProvider(integration.provider.id);
  const accountId = fixtureAccountId(binding, integration.provider.id);
  const integrationId = "id" in integration ? integration.id : undefined;
  if (
    !provider ||
    !FIXTURE_PROVIDERS.some((id) => id === provider.id) ||
    integrationId !== accountId ||
    integration.composioAccountId !== accountId ||
    integration.sokoBotId !== binding.sokoBotId ||
    integration.entityId !== undefined ||
    ![
      provider.tools.listMessages,
      provider.tools.getMessage,
      provider.tools.listEvents,
    ].includes(slug)
  ) {
    throw new Error(FIXTURE_DENIED);
  }
  return executeMailboxFixture(binding, provider.id, slug, args);
}
