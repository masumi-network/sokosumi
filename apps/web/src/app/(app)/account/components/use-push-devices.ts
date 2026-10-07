"use client";

import type { PushDevice } from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { handleRevokedPushDevice } from "@/lib/ably/push-revocation.client";
import { readAblyPushDeviceId } from "@/lib/ably/release-push-device.client";
import { revokePushDevice } from "@/lib/services/push-devices.service";
import {
  getPushDevicesQueryKey,
  getPushDevicesQueryOptions,
  type PushDevicesData,
  refreshPushDevices,
} from "@/queries/push-devices";

export function usePushDevices(userId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<{
    userId: string;
    device: PushDevice;
  } | null>(null);
  const selectedDevice = selection?.userId === userId ? selection.device : null;
  const query = useQuery({
    ...getPushDevicesQueryOptions(userId),
    enabled,
  });
  const removal = useMutation({
    mutationFn: async (target: { userId: string; device: PushDevice }) => {
      await revokePushDevice(target.device.id);
      const queryKey = getPushDevicesQueryKey(target.userId);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<PushDevicesData>(queryKey, (data) =>
        data
          ? {
              ...data,
              devices: data.devices.filter(({ id }) => id !== target.device.id),
            }
          : data,
      );
      if (readAblyPushDeviceId(target.userId) === target.device.id) {
        // Core accepted removal. Local cleanup must not hold the dialog open.
        void handleRevokedPushDevice(target.userId).catch(() => {
          console.warn(
            "Unable to clean up the removed push device in this browser",
          );
        });
      }
      void refreshPushDevices(queryClient, target.userId);
    },
    onSuccess: (_data, target) => {
      setSelection((current) => (current === target ? null : current));
    },
  });

  function selectDevice(device: PushDevice | null) {
    if (removal.isPending) return;
    removal.reset();
    setSelection(device ? { userId, device } : null);
  }

  function removeSelectedDevice() {
    if (!selection || !selectedDevice || removal.isPending) return;
    removal.mutate(selection);
  }

  return {
    ...query,
    selectedDevice,
    selectDevice,
    removeSelectedDevice,
    isRemoving: removal.isPending,
    removeFailed: removal.isError,
  };
}
