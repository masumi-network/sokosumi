import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  JobInputOptionSchemaType,
  JobInputSchemaType,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input";

export const isOptional = (jobInputSchema: JobInputSchemaType): boolean => {
  const { type } = jobInputSchema;
  if (type === ValidJobInputTypes.NONE) return true;

  const validations = jobInputSchema.validations;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === ValidJobInputValidationTypes.OPTIONAL && value === "true",
  );
};

export const isSingleOption = (
  jobInputOptionSchema: JobInputOptionSchemaType,
): boolean => {
  const { validations } = jobInputOptionSchema;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === ValidJobInputValidationTypes.MAX && value <= 1,
  );
};

export function useRouterRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [resolve, setResolve] = useState<((value: unknown) => void) | null>(
    null,
  );
  const [isTriggered, setIsTriggered] = useState(false);

  const refresh = () => {
    return new Promise((resolve, _reject) => {
      setResolve(() => resolve);
      startTransition(() => {
        router.refresh();
      });
    });
  };

  useEffect(() => {
    if (isTriggered && !isPending) {
      if (resolve) {
        resolve(null);

        setIsTriggered(false);
        setResolve(null);
      }
    }
    if (isPending) {
      setIsTriggered(true);
    }
  }, [isTriggered, isPending, resolve]);

  return refresh;
}

export function useRouterPush() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [resolve, setResolve] = useState<((value: unknown) => void) | null>(
    null,
  );
  const [isTriggered, setIsTriggered] = useState(false);

  const push = (path: string) => {
    return new Promise((resolve, _reject) => {
      setResolve(() => resolve);
      startTransition(() => {
        router.push(path);
      });
    });
  };

  useEffect(() => {
    if (isTriggered && !isPending) {
      if (resolve) {
        resolve(null);

        setIsTriggered(false);
        setResolve(null);
      }
    }
    if (isPending) {
      setIsTriggered(true);
    }
  }, [isTriggered, isPending, resolve]);

  return push;
}
