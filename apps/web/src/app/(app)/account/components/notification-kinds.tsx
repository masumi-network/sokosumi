"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  DELIVERIES,
  DELIVERY_HINT_KEY,
  DELIVERY_LABEL_KEY,
  type Delivery,
  presetChanges,
} from "./notification-delivery";
import { PresetStops } from "./notification-presets";
import {
  type GroupChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

/**
 * Where one kind arrives: off, in Sokosumi, or a banner as well.
 *
 * Three stops on the row rather than a menu, because the answer is worth
 * reading without opening anything and the choices are worth comparing. The
 * labels are short for the same reason: three of them share a line with the
 * name they belong to, in every language this ships in.
 */
function DeliveryStops({
  kind,
  delivery,
  disabled,
  onPick,
}: {
  kind: string;
  delivery: Delivery;
  disabled: boolean;
  onPick: (delivery: Delivery) => void;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <div
      role="group"
      aria-label={t("deliveryAriaLabel", { kind })}
      className="border-input bg-background inline-flex shrink-0 rounded-full border p-0.5"
    >
      {DELIVERIES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={delivery === candidate}
          disabled={disabled}
          title={t(DELIVERY_HINT_KEY[candidate])}
          onClick={() => {
            onPick(candidate);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50",
            delivery === candidate
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {t(DELIVERY_LABEL_KEY[candidate])}
        </button>
      ))}
    </div>
  );
}

/** One kind of notification, what it is, and where it arrives. */
function KindRow({
  label,
  hint,
  delivery,
  disabled,
  indent = false,
  onPick,
}: {
  label: string;
  hint: string;
  delivery: Delivery;
  disabled: boolean;
  indent?: boolean;
  onPick: (delivery: Delivery) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        indent && "sm:pl-10",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm leading-5">{label}</p>
        <p className="text-muted-foreground text-sm leading-5">{hint}</p>
      </div>
      <DeliveryStops
        kind={label}
        delivery={delivery}
        disabled={disabled}
        onPick={onPick}
      />
    </div>
  );
}

/**
 * A group that folds, with its kinds under it.
 *
 * The group control offers the answers that mean something for this group, and
 * the kinds under it stay separately selectable. Chat is the case this exists
 * for: mentions, direct messages and every message in a room are usually one
 * decision and sometimes three. Set one by one, the group says Custom and that
 * stop opens the fold rather than picking for you.
 */
function GroupRows({
  group,
  choices,
}: {
  group: GroupChoice;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const kinds = group.kinds.map((kind) => kind.spec);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {/* The trigger holds no control of its own: a button inside a button is
            not a thing a browser can do. */}
        <CollapsibleTrigger className="group focus-visible:ring-ring/50 -m-1 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px]">
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0">
            <span className="block text-sm leading-5">
              {t(group.spec.labelKey)}
            </span>
            {group.spec.descriptionKey ? (
              <span className="text-muted-foreground block truncate text-sm leading-5">
                {t(group.spec.descriptionKey)}
              </span>
            ) : null}
          </span>
        </CollapsibleTrigger>
        <PresetStops
          group={t(group.spec.labelKey)}
          kinds={kinds}
          preset={group.preset}
          disabled={group.saving}
          onCustom={() => {
            setOpen(true);
          }}
          onPick={(preset) => {
            void choices.setDeliveries(presetChanges(preset, kinds));
          }}
        />
      </div>
      <CollapsibleContent>
        <div className="bg-muted/20 divide-y border-t">
          {group.kinds.map((kind) => (
            <KindRow
              key={kind.spec.category}
              label={t(kind.spec.labelKey)}
              hint={t(kind.spec.hintKey)}
              delivery={kind.delivery}
              disabled={kind.saving}
              indent
              onPick={(delivery) => {
                void choices.setDeliveries([
                  { category: kind.spec.category, delivery },
                ]);
              }}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What you get notified about, and where each kind arrives.
 *
 * One row per kind, and one control on it. The switch matrix this replaces
 * asked the same question as two switches per row, which let a reader ask for a
 * banner and no entry in Sokosumi, and made the common answer two presses.
 */
export function NotificationKinds() {
  const t = useTranslations("App.Account.Notifications");
  const choices = useNotificationDelivery();

  if (choices.groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm leading-5 font-medium">{t("kindsTitle")}</p>
        <p className="text-muted-foreground text-sm leading-6">
          {t("kindsDescription")}
        </p>
      </div>
      <div className="divide-y rounded-lg border">
        {choices.groups.map((group) => {
          const [only] = group.kinds;

          // A group of one is its kind: folding it away behind a chevron would
          // hide the control without shortening the page.
          return group.kinds.length === 1 && only ? (
            <KindRow
              key={group.spec.id}
              label={t(group.spec.labelKey)}
              hint={t(only.spec.hintKey)}
              delivery={only.delivery}
              disabled={only.saving}
              onPick={(delivery) => {
                void choices.setDeliveries([
                  { category: only.spec.category, delivery },
                ]);
              }}
            />
          ) : (
            <GroupRows key={group.spec.id} group={group} choices={choices} />
          );
        })}
      </div>
      <p className="text-muted-foreground text-sm leading-6">
        {t("bannerHint")}
      </p>
    </div>
  );
}
