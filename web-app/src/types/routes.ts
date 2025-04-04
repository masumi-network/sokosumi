// types/routes.ts
export enum LandingRoute {
  Home = "/",
  SignIn = "/signin",
  SignUp = "/signup",
  ForgotPassword = "/forgot-password",
  ResetPassword = "/reset-password",
  Agents = "/agents",
}

export enum AppRoute {
  Home = "/app",
  Account = "/app/account",
  Agents = "/app/agents",
  Jobs = "/app/jobs",
  Billing = "/app/billing",
  Settings = "/app/settings",
}

interface Route {
  pathname: string;
  query?: Record<string, string>;
}
export type Routes =
  | (Route & { pathname: "/" })
  | (Route & { pathname: "/signin" })
  | (Route & { pathname: "/signup" })
  | (Route & { pathname: "/forgot-password"; query?: { email: string } })
  | (Route & { pathname: "/reset-password" })
  | (Route & { pathname: "/agents" })
  | (Route & { pathname: "/agents/:agentId"; query: { agentId: string } })
  | (Route & { pathname: "/app" })
  | (Route & { pathname: "/app/account" })
  | (Route & { pathname: "/app/agents" })
  | (Route & { pathname: "/app/agents/:agentId"; query: { agentId: string } })
  | (Route & { pathname: "/app/agents/:agentId/jobs" })
  | (Route & {
      pathname: "/app/agents/:agentId/jobs/:jobId";
      query: { agentId: string; jobId: string };
    })
  | (Route & { pathname: "/app/jobs" })
  | (Route & { pathname: "/app/jobs/:jobId"; query: { jobId: string } })
  | (Route & { pathname: "/app/billing" })
  | (Route & { pathname: "/app/settings" });
