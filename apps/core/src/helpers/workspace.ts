interface WorkspaceSummaryOrganization {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceSummarySource {
  id: string;
  organizationId: string | null;
  organization: WorkspaceSummaryOrganization | null;
}

export function mapWorkspaceSummary(workspace: WorkspaceSummarySource) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    organization: workspace.organization
      ? {
          id: workspace.organization.id,
          name: workspace.organization.name,
          slug: workspace.organization.slug,
        }
      : null,
  };
}
