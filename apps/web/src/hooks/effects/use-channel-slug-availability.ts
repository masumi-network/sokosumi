"use client";

import { useEffect, useState } from "react";
import { checkChannelSlugAvailabilityAction } from "@/app/chat/actions";
import type {
  ChannelSlugCheckState,
  CreateChannelWizard,
} from "@/app/chat/components/create-channel-wizard";

/**
 * Debounces channel slug availability checks while `CreateChannelDialog` is on
 * its `"create"` step.
 */
export function useChannelSlugAvailability(
  wizard: CreateChannelWizard,
  createStepSlug: string,
) {
  const [availability, setAvailability] =
    useState<ChannelSlugCheckState>("invalid");

  useEffect(() => {
    if (wizard.step !== "create") {
      return;
    }
    if (!createStepSlug) {
      setAvailability("invalid");
      return;
    }
    setAvailability("unknown");
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await checkChannelSlugAvailabilityAction(createStepSlug);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setAvailability("error");
        return;
      }
      setAvailability(result.value.status);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wizard.step, createStepSlug]);

  return { availability, setAvailability };
}
