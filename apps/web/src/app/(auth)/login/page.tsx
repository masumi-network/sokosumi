import { redirect } from "next/navigation";

import {
  type AuthRedirectSearchParams,
  getRedirectQueryString,
} from "@/lib/auth/auth.utils";

interface LoginRedirectProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function LoginRedirect({
  searchParams,
}: LoginRedirectProps) {
  const query = await getRedirectQueryString(searchParams);
  redirect(query ? `/signin?${query}` : "/signin");
}
