"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface BreadcrumbOverrideSegment {
  label: string;
  href: string;
}

export interface BreadcrumbOverride {
  pathname: string;
  segments: BreadcrumbOverrideSegment[];
}

interface RegisteredBreadcrumbOverride extends BreadcrumbOverride {
  key: symbol;
}

interface BreadcrumbOverrideContextValue {
  override: BreadcrumbOverride | null;
  setOverride: (
    updater: (
      current: RegisteredBreadcrumbOverride | null,
    ) => RegisteredBreadcrumbOverride | null,
  ) => void;
}

const BreadcrumbOverrideContext = createContext<BreadcrumbOverrideContextValue>(
  {
    override: null,
    setOverride: () => {},
  },
);

function isSameOverride(
  current: RegisteredBreadcrumbOverride | null,
  next: BreadcrumbOverride,
  key: symbol,
): boolean {
  return (
    current?.key === key &&
    current.pathname === next.pathname &&
    current.segments.length === next.segments.length &&
    current.segments.every(
      (segment, index) =>
        segment.label === next.segments[index]?.label &&
        segment.href === next.segments[index]?.href,
    )
  );
}

export function BreadcrumbOverrideProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [override, setOverride] = useState<RegisteredBreadcrumbOverride | null>(
    null,
  );
  const value = useMemo(
    () => ({
      override,
      setOverride,
    }),
    [override],
  );

  return (
    <BreadcrumbOverrideContext value={value}>
      {children}
    </BreadcrumbOverrideContext>
  );
}

export function useBreadcrumbOverride() {
  return useContext(BreadcrumbOverrideContext).override;
}

export function useRegisterBreadcrumbOverride(
  override: BreadcrumbOverride | null,
) {
  const { setOverride } = useContext(BreadcrumbOverrideContext);
  const keyRef = useRef<symbol>(Symbol("breadcrumb-override"));
  const serializedOverride = override ? JSON.stringify(override) : null;

  useEffect(() => {
    const key = keyRef.current;

    if (!serializedOverride) {
      setOverride((current) => (current?.key === key ? null : current));
      return;
    }

    const nextOverride = JSON.parse(serializedOverride) as BreadcrumbOverride;

    setOverride((current) =>
      isSameOverride(current, nextOverride, key)
        ? current
        : {
            ...nextOverride,
            key,
          },
    );

    return () => {
      setOverride((current) => (current?.key === key ? null : current));
    };
  }, [serializedOverride, setOverride]);
}
