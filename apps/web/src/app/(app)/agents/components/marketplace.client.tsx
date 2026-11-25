"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useMemo } from "react";

import { AgentIcon } from "@/components/agents/agent-icon";
import { AgentVendor } from "@/components/agents/agent-vendor";
import {
  AGENT_TILE_GRID_CLASS,
  AgentTile,
} from "@/components/agents/directory/agent-tile";
import { Input } from "@/components/ui/input";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import {
  getAgentAuthorResolvedImage,
  getAgentResolvedIcon,
  getShortAgentAuthorName,
} from "@/lib/helpers/agent";
import { rankPageItems } from "@/lib/utils/page-search";

function agentHref(agent: CatalogBrowseAgent): string | null {
  return agent.kind === "cardano" ? `/agents/${agent.id}` : agent.externalUrl;
}

/** Every external agent, behind one search field. */
export function Marketplace({ agents }: { agents: CatalogBrowseAgent[] }) {
  const t = useTranslations("App.Agents.Directory");
  const [query, setQuery] = useQueryState("query", { defaultValue: "" });

  const shown = useMemo(
    () =>
      rankPageItems(
        agents.filter((agent) => agentHref(agent)),
        query,
        (agent) => ({
          primary: [agent.name],
          secondary: [
            agent.summary,
            agent.description,
            agent.author.name,
            agent.author.organization,
            ...agent.categories.map((category) => category.name),
          ],
        }),
      ),
    [agents, query],
  );

  function meta(agent: CatalogBrowseAgent) {
    const vendor = getShortAgentAuthorName(agent);
    return (
      <AgentVendor
        logo={getAgentAuthorResolvedImage(agent)}
        label={vendor ? t("byVendor", { vendor }) : t("aboutSourceExternal")}
        alt={t("vendorLogo", { agent: agent.name })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">{t("searchLabel")}</span>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => void setQuery(event.target.value || null)}
          placeholder={t("searchPlaceholder")}
          className="bg-background h-10 pl-9"
        />
      </label>
      <p role="status" aria-live="polite" className="sr-only">
        {query.trim() ? t("found", { count: shown.length }) : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {query.trim() ? t("noMatch") : t("marketplaceEmpty")}
        </p>
      ) : (
        <ul className={AGENT_TILE_GRID_CLASS}>
          {shown.map((agent) => (
            <li key={agent.id}>
              <AgentTile
                href={agentHref(agent) ?? "/agents"}
                external={agent.kind === "x402"}
                avatar={
                  <span className="border-border bg-card-background flex size-10 items-center justify-center rounded-lg border">
                    <AgentIcon
                      agent={{
                        name: agent.name,
                        icon: getAgentResolvedIcon(agent),
                      }}
                      className="size-5"
                    />
                  </span>
                }
                name={agent.name}
                purpose={agent.summary ?? agent.description}
                meta={meta(agent)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
