"use client";

/**
 * PROTOTYPE, not production: three directions for the "connect your inbox and
 * calendar" prompt above the bot DM composer, switchable via `?variant=`.
 * Primary axis: structure, i.e. how the ask relates to the composer.
 *   docked    – a slim tray fused to the composer's top edge
 *   in-thread – the bot asks, as a message pinned above the composer
 *   compact   – one quiet pill; providers live in a menu
 * `current` keeps the shipped card as the baseline to compare against.
 */

import { Check, ChevronDown, Inbox, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { AuroraOrb } from "@/components/aurora-orb";
import {
  PrototypeVariantPicker,
  usePrototypeVariant,
} from "@/components/prototype/variant-picker.client";
import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { cn } from "@/lib/utils";

import {
  SokoBotConnectCard,
  type SokoBotConnectFace,
  useConnectProvider,
} from "./soko-bot-connect-prompt.client";

export const CONNECT_PROMPT_VARIANTS = [
  "docked",
  "in-thread",
  "compact",
  "current",
] as const;
export type ConnectPromptVariant = (typeof CONNECT_PROMPT_VARIANTS)[number];

const LABELS: Record<ConnectPromptVariant, string> = {
  docked: "Docked",
  "in-thread": "In-thread",
  compact: "Compact",
  current: "Current",
};

export interface ConnectPromptVariantProps {
  botName: string;
  face: SokoBotConnectFace | null;
  offers: SokoBotConnectOffer[];
  onDismiss: () => void;
}

export function SokoBotConnectPromptPrototype(
  props: ConnectPromptVariantProps,
) {
  const variant = usePrototypeVariant(CONNECT_PROMPT_VARIANTS);
  return (
    <>
      <ConnectPromptVariantView variant={variant} {...props} />
      <PrototypeVariantPicker
        variants={CONNECT_PROMPT_VARIANTS}
        labels={LABELS}
      />
    </>
  );
}

export function ConnectPromptVariantView({
  variant,
  ...props
}: ConnectPromptVariantProps & { variant: ConnectPromptVariant }) {
  // Same inline inset as the composer form (`px-3 md:px-5`), so the prompt
  // lines up with the composer's edges instead of the column's.
  // `current` stays unwrapped: it is the shipped baseline, misalignment and all.
  if (variant === "current") return <SokoBotConnectCard {...props} />;
  return (
    <div className="px-3 md:px-5">
      {variant === "docked" ? <DockedVariant {...props} /> : null}
      {variant === "in-thread" ? <InThreadVariant {...props} /> : null}
      {variant === "compact" ? <CompactVariant {...props} /> : null}
    </div>
  );
}

function ProviderLogo({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const Logo = SOKO_BOT_PROVIDER_LOGOS[provider];
  return Logo ? <Logo className={cn("shrink-0", className)} /> : null;
}

/**
 * Docked: a tray that sits on the composer like an attachment strip. Inset
 * one radius step so it reads as part of the composer, not a second card.
 * Logo-only provider buttons keep it to one line on desktop.
 */
function DockedVariant({
  botName,
  offers,
  onDismiss,
}: ConnectPromptVariantProps) {
  const t = useTranslations("App.Chat.SokoBot");
  const { busy, connect } = useConnectProvider();
  return (
    <section
      data-testid="soko-bot-connect-prompt"
      aria-label={t("connectTitle", { bot: botName })}
      className="border-border bg-background-muted mx-3 -mb-px flex items-center gap-3 rounded-t-lg border border-b-0 py-1.5 ps-3 pe-1.5"
    >
      <Inbox aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-xs leading-5">
        <span className="font-medium">
          {t("connectTitle", { bot: botName })}
        </span>
        <span className="text-muted-foreground max-sm:hidden">
          {" · "}
          {t("connectBody")}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        {offers.map((offer) => (
          <Button
            key={offer.provider}
            type="button"
            size="icon"
            variant="ghost"
            disabled={offer.connected || busy !== null}
            aria-label={
              offer.connected
                ? t("connectConnected", { name: offer.name })
                : t("connectProvider", { name: offer.name })
            }
            title={offer.name}
            onClick={() => connect(offer.provider)}
            className="relative size-7"
          >
            <ProviderLogo provider={offer.provider} className="size-4" />
            {offer.connected ? (
              <Check
                aria-hidden
                className="bg-background text-semantic-success absolute -end-0.5 -bottom-0.5 size-3 rounded-full"
              />
            ) : null}
          </Button>
        ))}
        <span aria-hidden className="bg-border mx-1 h-4 w-px" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("connectDismiss")}
          onClick={onDismiss}
          className="text-muted-foreground size-7"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}

/**
 * In-thread: the bot makes the ask in its own voice, laid out like its
 * message rows (32px face, name line, body), so it belongs to the transcript.
 * Providers are pill chips; "Not now" replaces the corner X.
 */
function InThreadVariant({
  botName,
  face,
  offers,
  onDismiss,
}: ConnectPromptVariantProps) {
  const t = useTranslations("App.Chat.SokoBot");
  const { busy, connect } = useConnectProvider();
  return (
    <section
      data-testid="soko-bot-connect-prompt"
      aria-label={t("connectTitle", { bot: botName })}
      className="mb-3 flex gap-3 px-2 md:px-0"
    >
      <BotFace botName={botName} face={face} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold md:text-sm">{botName}</span>
          <span className="text-muted-foreground text-xs">
            {t("connectOnlyYou")}
          </span>
        </div>
        <p className="mt-0.5 max-w-prose text-sm text-pretty">
          {t("connectMessage")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {offers.map((offer) => (
            <button
              key={offer.provider}
              type="button"
              disabled={offer.connected || busy !== null}
              aria-label={
                offer.connected
                  ? t("connectConnected", { name: offer.name })
                  : t("connectProvider", { name: offer.name })
              }
              onClick={() => connect(offer.provider)}
              className="border-border bg-background press hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-60 sm:h-7"
            >
              <ProviderLogo provider={offer.provider} className="size-3.5" />
              {offer.name}
              {offer.connected ? (
                <Check aria-hidden className="text-semantic-success size-3.5" />
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center rounded-full px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 sm:h-7"
          >
            {t("connectNotNow")}
          </button>
        </div>
      </div>
    </section>
  );
}

function BotFace({
  botName,
  face,
}: {
  botName: string;
  face: SokoBotConnectFace | null;
}) {
  if (face?.avatarSeed && !face.image) {
    return (
      <AuroraOrb
        seed={face.avatarSeed}
        size={64}
        alt=""
        className="ring-border mt-0.5 size-8 shrink-0 ring-1"
      />
    );
  }
  return (
    <Avatar className="mt-0.5 size-8 shrink-0">
      <AvatarImage src={face?.image ?? undefined} alt="" />
      <AvatarFallback className="bg-primary-quinary text-primary text-xs">
        {botName.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Compact: one pill with the provider logos stacked, opening a menu. Lowest
 * footprint: it costs a single 28px line above the composer.
 */
function CompactVariant({
  botName,
  offers,
  onDismiss,
}: ConnectPromptVariantProps) {
  const t = useTranslations("App.Chat.SokoBot");
  const { busy, connect } = useConnectProvider();
  return (
    <section
      data-testid="soko-bot-connect-prompt"
      aria-label={t("connectTitle", { bot: botName })}
      className="mb-2 flex items-center gap-1"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-border bg-background press hover:bg-muted focus-visible:ring-ring data-[state=open]:bg-muted inline-flex h-8 items-center gap-2 rounded-full border ps-1.5 pe-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 sm:h-7"
          >
            <span className="flex -space-x-1">
              {offers.map((offer) => (
                <span
                  key={offer.provider}
                  className="bg-background ring-background flex size-5 items-center justify-center rounded-full ring-1"
                >
                  <ProviderLogo provider={offer.provider} className="size-3" />
                </span>
              ))}
            </span>
            {t("connectCompact")}
            <ChevronDown
              aria-hidden
              className="text-muted-foreground size-3.5"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="space-y-0.5 font-normal">
            <span className="block text-sm font-medium">
              {t("connectTitle", { bot: botName })}
            </span>
            <span className="text-muted-foreground block text-xs text-pretty">
              {t("connectBody")}
            </span>
          </DropdownMenuLabel>
          {offers.map((offer) => (
            <DropdownMenuItem
              key={offer.provider}
              disabled={offer.connected || busy !== null}
              onSelect={() => connect(offer.provider)}
              className="gap-2"
            >
              <ProviderLogo provider={offer.provider} className="size-4" />
              <span className="flex-1">
                {offer.connected
                  ? t("connectConnected", { name: offer.name })
                  : t("connectProvider", { name: offer.name })}
              </span>
              {offer.connected ? (
                <Check aria-hidden className="text-semantic-success size-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={t("connectDismiss")}
        onClick={onDismiss}
        className="text-muted-foreground size-7 rounded-full"
      >
        <X aria-hidden className="size-3.5" />
      </Button>
    </section>
  );
}
