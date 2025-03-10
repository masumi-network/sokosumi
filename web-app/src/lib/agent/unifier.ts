import { Agent, ExampleOutput } from "@prisma/client";

export type UnifiedAgent = {
    name: string;
    description: string | null;
    apiUrl: string;
    ExampleOutput: {
        name: string;
        mimeType: string;
        url: string;
    }[];
    Capability: {
        name: string;
        version: string;

    }
    requestsPerHour: string | null;
    Author: {
        name: string;
        contactEmail: string | null;
        contactOther: string | null;
        organization: string | null;
    }
    Legal: {
        privacyPolicy: string | null;
        terms: string | null;
        other: string | null;
    }
    tags: string[];
    image: string;
    metadataVersion: number;
};

export function unifyAgent(agent: Agent & { ExampleOutput: ExampleOutput[], ExampleOutputOverride: ExampleOutput[] }): UnifiedAgent {
    return {
        name: agent.overrideName ?? agent.onChainName,
        description: agent.overrideDescription ?? agent.onChainDescription,
        apiUrl: agent.overrideApiUrl ?? agent.onChainApiUrl,
        ExampleOutput: agent.ExampleOutputOverride.length > 0 ? agent.ExampleOutputOverride : agent.ExampleOutput.length > 0 ? agent.ExampleOutput : [],
        Capability: {
            name: agent.overrideCapabilityName ?? agent.onChainCapabilityName,
            version: agent.overrideCapabilityVersion ?? agent.onChainCapabilityVersion,
        },
        requestsPerHour: agent.overrideRequestsPerHour ?? agent.onChainRequestsPerHour,
        Author: {
            name: agent.overrideAuthorName ?? agent.onChainAuthorName,
            contactEmail: agent.overrideAuthorContact ?? agent.onChainAuthorContact,
            contactOther: agent.overrideAuthorContact ?? agent.onChainAuthorContact,
            organization: agent.overrideAuthorOrganization ?? agent.onChainAuthorOrganization,
        },
        Legal: {
            privacyPolicy: agent.overrideLegalPrivacyPolicy ?? agent.onChainLegalPrivacyPolicy,
            terms: agent.overrideLegalTerms ?? agent.onChainLegalTerms,
            other: agent.overrideLegalOther ?? agent.onChainLegalOther,
        },
        tags: agent.overrideTags.length > 0 ? agent.overrideTags : agent.onChainTags,
        image: agent.overrideImage ?? agent.onChainImage,
        metadataVersion: agent.overrideMetadataVersion ?? agent.onChainMetadataVersion,
    };
} 