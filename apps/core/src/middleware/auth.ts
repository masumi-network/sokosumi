export interface AuthenticatedUserContext {
  id: string;
  organizationId: string | null;
}

export type AuthVariables = {
  isAuthenticated: boolean;
  user?: AuthenticatedUserContext;
};
