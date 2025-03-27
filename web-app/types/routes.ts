// types/routes.ts
export enum LandingRoute {
  Home = "/",
  SignIn = "/signin",
  SignUp = "/signup",
  ForgotPassword = "/forgot-password",
  ResetPassword = "/reset-password",
  Agents = "/gallery",
  Agent = "/gallery/:id",
}

export enum AppRoute {
  Dashboard = "/dashboard",
  Account = "/dashboard/account",
  Agents = "/dashboard/gallery",
  Agent = "/dashboard/gallery/:id",
}

export function getPath(
  route: AppRoute | LandingRoute,
  params?: { id?: string },
): string {
  let path: string = route;

  if (params?.id) {
    path = path.replace(":id", params.id);
  }
  return path;
}
