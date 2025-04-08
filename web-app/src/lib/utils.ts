import json from "@tufjs/canonical-json";
import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import { twMerge } from "tailwind-merge";

import { getEnvSecrets } from "@/config/env.config";

import prisma from "./db/prisma";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function timeLimitedExecution<T>(
  fn: () => Promise<T>,
  timeout: number,
): Promise<T> {
  const result = await Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeout),
    ),
  ]);
  if (result instanceof Error) {
    throw result;
  }
  return result as T;
}

export async function getLock(lockKey: string) {
  return await prisma.$transaction(async (tx) => {
    // Example: Try to acquire a lock on a specific agent
    // Using pessimistic locking with 'FOR UPDATE'
    const lock = await tx.lock.findFirst({
      where: {
        key: lockKey,
      },
    });

    if (!lock) {
      return await tx.lock.create({
        data: {
          key: lockKey,
          lockedBy: getEnvSecrets().INSTANCE_ID,
          lockedAt: new Date(),
          isLocked: true,
        },
      });
    }

    if (lock.isLocked) {
      if (
        lock.lockedAt &&
        lock.lockedAt < new Date(Date.now() - getEnvSecrets().LOCK_TIMEOUT)
      ) {
        //TODO: better logging
        console.warn(
          "Lock timeout reached, will release key",
          lockKey,
          "last updated at: ",
          lock.updatedAt,
          " by instance: ",
          lock.lockedBy,
        );
        return await tx.lock.update({
          where: { id: lock.id },
          data: {
            lockedBy: getEnvSecrets().INSTANCE_ID,
            lockedAt: new Date(),
            isLocked: true,
          },
        });
      }
      return null;
    }
    return await tx.lock.update({
      where: { id: lock.id },
      data: {
        lockedBy: getEnvSecrets().INSTANCE_ID,
        lockedAt: new Date(),
        isLocked: true,
      },
    });
  });
}

export async function releaseLock(lock: { updatedAt: Date; key: string }) {
  const updatedLock = await prisma.lock.update({
    where: { key: lock.key, updatedAt: lock.updatedAt },
    data: { isLocked: false, lockedBy: null, lockedAt: null },
  });
  if (!updatedLock) {
    console.error(
      "Lock changed while locked, will not release. Expected key",
      lock.key,
      "to be last updated at: ",
      lock.updatedAt,
    );
  }
}

export const calculatedInputHash = (
  inputData: Map<string, string | number | boolean | number[]>,
  identifierFromPurchaser: string,
) => {
  const inputString = json.canonicalize(Object.fromEntries(inputData));
  return createHash(identifierFromPurchaser + inputString);
};

export const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input).digest("hex");
};
