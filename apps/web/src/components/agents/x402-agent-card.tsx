"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Bot, Radio, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CarouselItem } from "@/components/ui/carousel";
import type { X402Agent } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { AgentCarousel } from "./agent-carousel";

const NETWORK_NAMES: Readonly<Record<string, string>> = {
  "eip155:1": "Ethereum",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
};

function getNetworkName(caip2Network: string): string {
  return NETWORK_NAMES[caip2Network] ?? caip2Network;
}

function resolveX402AgentImage(image: string | null): string | null {
  return image ? resolveIpfsOrHttpUrl(image) : null;
}

type FixedX402Agent = Extract<X402Agent, { pricingType: "fixed" }>;

function getLowestCreditPrice(agent: FixedX402Agent): number {
  return Math.min(...agent.paymentSources.map((source) => source.credits));
}

function filterX402AgentsByQuery(
  agents: X402Agent[],
  query: string,
): X402Agent[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return agents;
  }

  return agents.filter((agent) => {
    return [
      agent.name,
      agent.description,
      "x402",
      agent.pricingType,
      agent.specification,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

interface X402AgentCardProps {
  agent: X402Agent;
  className?: string;
}

function X402AgentCard({ agent, className }: X402AgentCardProps) {
  const t = useTranslations("Components.Agents.X402Card");
  const format = useFormatter();
  const lowestCreditPrice =
    agent.pricingType === "fixed" ? getLowestCreditPrice(agent) : null;
  let pricingLabel: string;
  if (agent.pricingType === "mixed") {
    pricingLabel = t("mixedPricing");
  } else if (lowestCreditPrice === null) {
    pricingLabel = t("dynamicPricing");
  } else {
    pricingLabel = t("pricing", {
      price: format.number(lowestCreditPrice, {
        maximumSignificantDigits: 3,
      }),
    });
  }
  const firstSource = agent.paymentSources[0];
  const resolvedImage = resolveX402AgentImage(agent.image);

  return (
    <Card
      className={cn(
        "group relative flex min-h-80 w-full flex-col overflow-hidden rounded-lg border-primary/20 bg-card-background px-4 py-6 shadow-none transition-colors md:w-80 md:hover:bg-foreground/5",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-primary/70"
      />

      <div className="mb-5 flex min-h-10 items-start justify-between gap-3">
        <Avatar className="size-10 shrink-0 rounded-md border border-border bg-background">
          {resolvedImage ? (
            <AvatarImage
              src={resolvedImage}
              alt=""
              className="rounded-md"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <AvatarFallback className="rounded-md">
            <Bot aria-hidden className="size-5 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          <Badge variant="outline" className="border-primary/30 text-primary">
            <Zap aria-hidden />
            x402
          </Badge>
          <Badge variant="outline">
            {agent.specification === "openapi"
              ? t("openApiSpec")
              : t("bazaarSpec")}
          </Badge>
          <Badge variant="secondary">{t("preview")}</Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="space-y-3">
          <h3 className="truncate text-base font-medium leading-6 text-foreground">
            {agent.name}
          </h3>
          <p className="line-clamp-3 min-h-15 text-sm leading-5 text-muted-foreground">
            {agent.description ?? t("fallbackDescription")}
          </p>
        </div>

        <div className="mt-auto space-y-4 pt-6">
          <div className="flex flex-wrap gap-1.5">
            {firstSource ? (
              <Badge variant="outline" className="font-normal">
                <Radio aria-hidden />
                {getNetworkName(firstSource.caip2Network)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="font-normal">
              {t("sources", { count: agent.paymentSources.length })}
            </Badge>
          </div>

          <div className="flex items-end justify-between gap-4 border-border/70 border-t pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("directPay")}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {pricingLabel}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <Zap aria-hidden className="size-3" />
              {agent.isPayable ? t("coworkerAccess") : t("previewOnly")}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface X402AgentsProps {
  agents: X402Agent[];
}

function X402Agents({ agents }: X402AgentsProps) {
  const t = useTranslations("Components.Agents.X402Card");

  if (agents.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4" aria-labelledby="x402-agents-title">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Zap aria-hidden className="size-5 text-primary" />
          <h3 id="x402-agents-title" className="text-lg font-medium">
            {t("title")}
          </h3>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <AgentCarousel
        itemCount={agents.length}
        itemIds={agents.map((agent) => agent.id)}
      >
        {agents.map((agent) => (
          <CarouselItem
            key={agent.id}
            className="basis-full md:basis-auto md:pr-2"
          >
            <X402AgentCard agent={agent} />
          </CarouselItem>
        ))}
      </AgentCarousel>
    </section>
  );
}

export {
  filterX402AgentsByQuery,
  resolveX402AgentImage,
  X402AgentCard,
  X402Agents,
};
