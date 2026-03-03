import { redirect } from "next/navigation";

import {
  AuthRedirectSearchParams,
  getRedirectQueryString,
} from "@/app/(auth)/redirect-query";

interface LoginRedirectProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function LoginRedirect({ searchParams }: LoginRedirectProps) {
  const query = await getRedirectQueryString(searchParams);
  redirect(query ? `/signin?${query}` : "/signin");
}
