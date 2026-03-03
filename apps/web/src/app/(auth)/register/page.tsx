import { redirect } from "next/navigation";

import {
  AuthRedirectSearchParams,
  getRedirectQueryString,
} from "@/app/(auth)/redirect-query";

interface RegisterRedirectProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function RegisterRedirect({
  searchParams,
}: RegisterRedirectProps) {
  const query = await getRedirectQueryString(searchParams);
  redirect(query ? `/signup?${query}` : "/signup");
}
