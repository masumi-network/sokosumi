import { z } from "zod";
import type { Network } from "@/lib/network";

export const PREPROD_MASUMI_WARNING =
  "Preprod is disabled because its Masumi configuration is incomplete";

const optionalValue = z.string().optional();
export const masumiEnvShape = {
  MAINNET_PAYMENT_API_URL: optionalValue,
  MAINNET_PAYMENT_API_KEY: optionalValue,
  MAINNET_REGISTRY_API_URL: optionalValue,
  MAINNET_REGISTRY_API_KEY: optionalValue,
  PREPROD_PAYMENT_API_URL: optionalValue,
  PREPROD_PAYMENT_API_KEY: optionalValue,
  PREPROD_REGISTRY_API_URL: optionalValue,
  PREPROD_REGISTRY_API_KEY: optionalValue,
};

export function masumiConfiguration(
  env: Partial<Record<keyof typeof masumiEnvShape, string>>,
  network: Network,
) {
  const prefix = network === "mainnet" ? "MAINNET" : "PREPROD";
  const paymentUrlName = `${prefix}_PAYMENT_API_URL` as const;
  const paymentKeyName = `${prefix}_PAYMENT_API_KEY` as const;
  const registryUrlName = `${prefix}_REGISTRY_API_URL` as const;
  const registryKeyName = `${prefix}_REGISTRY_API_KEY` as const;
  const paymentUrl = z.url().safeParse(env[paymentUrlName]);
  const registryUrl = z.url().safeParse(env[registryUrlName]);
  const paymentKey = env[paymentKeyName];
  const registryKey = env[registryKeyName];
  if (
    paymentUrl.success &&
    registryUrl.success &&
    paymentKey?.trim() &&
    registryKey?.trim()
  ) {
    return {
      paymentUrl: paymentUrl.data,
      paymentKey,
      registryUrl: registryUrl.data,
      registryKey,
    };
  }
  const missing: string[] = [];
  if (!paymentUrl.success) missing.push(paymentUrlName);
  if (!paymentKey?.trim()) missing.push(paymentKeyName);
  if (!registryUrl.success) missing.push(registryUrlName);
  if (!registryKey?.trim()) missing.push(registryKeyName);
  return { missing };
}
