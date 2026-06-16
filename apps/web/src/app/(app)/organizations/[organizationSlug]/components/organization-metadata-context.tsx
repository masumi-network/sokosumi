"use client";

import type { Organization } from "@sokosumi/utils";
import {
  buildOrganizationMetadataWithDesignMd,
  parseOrganizationMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useState,
} from "react";

import type { DesignMdProfileValue } from "@/components/design-md";

interface OrganizationMetadataContextValue {
  metadata: string | null;
  updateDesignMd: (value?: DesignMdProfileValue) => void;
}

const OrganizationMetadataContext =
  createContext<OrganizationMetadataContextValue | null>(null);

interface OrganizationMetadataProviderProps {
  organization: Organization;
  children: ReactNode;
}

export function OrganizationMetadataProvider({
  organization,
  children,
}: OrganizationMetadataProviderProps) {
  const [metadata, setMetadata] = useState<string | null>(
    organization.metadata ?? null,
  );
  const [prevOrganizationMetadata, setPrevOrganizationMetadata] = useState(
    organization.metadata,
  );

  if (organization.metadata !== prevOrganizationMetadata) {
    setPrevOrganizationMetadata(organization.metadata);
    setMetadata(organization.metadata ?? null);
  }

  const updateDesignMd = useCallback((value?: DesignMdProfileValue) => {
    setMetadata((currentMetadata) => {
      const nextMetadata = buildOrganizationMetadataWithDesignMd(
        parseOrganizationMetadata(currentMetadata),
        {
          extractionId: value?.extractionId ?? null,
          url: value?.url ?? null,
        },
      );

      return serializeMetadataRecord(nextMetadata);
    });
  }, []);

  return (
    <OrganizationMetadataContext
      value={{
        metadata,
        updateDesignMd,
      }}
    >
      {children}
    </OrganizationMetadataContext>
  );
}

export function useOrganizationMetadata(): OrganizationMetadataContextValue {
  const context = use(OrganizationMetadataContext);
  if (!context) {
    throw new Error(
      "useOrganizationMetadata must be used within OrganizationMetadataProvider",
    );
  }

  return context;
}
