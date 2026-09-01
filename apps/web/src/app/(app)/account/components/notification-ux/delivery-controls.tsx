"use client";

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CHANNEL_LABEL } from "./group-summary";
import {
  DELIVERIES,
  DELIVERY_COPY,
  DELIVERY_RANK,
  type Delivery,
  type SubjectChoice,
} from "./notification-model";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * Why a delivery cannot be chosen on this row, when it cannot.
 *
 * A subject another subject already carries cannot be quieter than its cover.
 * The stop is not hidden: a reader looking for "off" on the mentions row has to
 * find out where "off" went, and an absent control cannot tell them.
 */
function blockedBecause(subject: SubjectChoice, delivery: Delivery) {
  if (DELIVERY_RANK[delivery] >= DELIVERY_RANK[subject.floor]) {
    return null;
  }

  return `${subject.coveredBy?.label ?? "Another setting"} already delivers this ${DELIVERY_COPY[subject.floor].sentence}`;
}

/** Off, in Sokosumi, or a banner. One press, three states, nothing hidden. */
export function DeliverySegments({
  subject,
  choices,
  className,
}: {
  subject: SubjectChoice;
  choices: NotificationChoices;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={subject.spec.label}
      className={cn(
        "border-input bg-background inline-flex rounded-full border p-0.5",
        className,
      )}
    >
      {DELIVERIES.map((delivery) => {
        const blocked = blockedBecause(subject, delivery);
        const active = subject.effective === delivery;

        return (
          <button
            key={delivery}
            type="button"
            aria-pressed={active}
            disabled={blocked !== null || subject.saving}
            title={blocked ?? undefined}
            onClick={() => {
              void choices.setSubject(subject.spec, delivery);
            }}
            className={cn(
              "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-40",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground enabled:hover:text-foreground",
            )}
          >
            {DELIVERY_COPY[delivery].short}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same three states as channels you tick.
 *
 * Email is the reason this shape exists: it is not louder than a banner, it is
 * somewhere else, and a ladder has no rung for it. It sits here disabled until
 * something sends it.
 */
export function DeliveryMenu({
  subject,
  choices,
}: {
  subject: SubjectChoice;
  choices: NotificationChoices;
}) {
  const set = (delivery: Delivery) => {
    void choices.setSubject(subject.spec, delivery);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={subject.spec.label}
        disabled={subject.saving}
        className="border-input hover:bg-accent focus-visible:ring-ring/50 data-[state=open]:bg-accent inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
      >
        {DELIVERY_COPY[subject.effective].short}
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuCheckboxItem
          checked={subject.effective !== "OFF"}
          disabled={blockedBecause(subject, "IN_APP") !== null}
          onSelect={(event) => {
            event.preventDefault();
            set(subject.effective === "OFF" ? "IN_APP" : "OFF");
          }}
        >
          {CHANNEL_LABEL.IN_APP}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={subject.effective === "BANNER"}
          disabled={blockedBecause(subject, "BANNER") !== null}
          onSelect={(event) => {
            event.preventDefault();
            set(subject.effective === "BANNER" ? "IN_APP" : "BANNER");
          }}
        >
          {CHANNEL_LABEL.OS_BANNER}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={false} disabled>
          {CHANNEL_LABEL.EMAIL}
          <span className="text-muted-foreground ml-auto text-xs">soon</span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * On or off, and the banner only once it is on.
 *
 * The smallest control on the page, and the one that grows: a reader who never
 * wants a banner never meets the second half of it.
 */
export function DeliverySwitch({
  subject,
  choices,
}: {
  subject: SubjectChoice;
  choices: NotificationChoices;
}) {
  const on = subject.effective !== "OFF";
  const banner = subject.effective === "BANNER";
  const blocked = blockedBecause(subject, "OFF");

  return (
    <div className="flex items-center gap-2">
      {on ? (
        <button
          type="button"
          aria-pressed={banner}
          disabled={subject.saving || subject.floor === "BANNER"}
          onClick={() => {
            void choices.setSubject(subject.spec, banner ? "IN_APP" : "BANNER");
          }}
          className={cn(
            "focus-visible:ring-ring/50 h-7 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            banner
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-accent",
          )}
        >
          {CHANNEL_LABEL.OS_BANNER}
        </button>
      ) : null}
      <Switch
        aria-label={subject.spec.label}
        checked={on}
        disabled={blocked !== null || subject.saving}
        title={blocked ?? undefined}
        onCheckedChange={(next) => {
          void choices.setSubject(subject.spec, next ? "IN_APP" : "OFF");
        }}
      />
    </div>
  );
}
