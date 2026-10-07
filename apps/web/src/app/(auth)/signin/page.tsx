import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  type AuthEntrySearchParams,
  renderAuthEntry,
} from "@/auth/components/auth-entry";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignIn.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignInPageProps {
  searchParams: Promise<AuthEntrySearchParams>;
}

export default function SignIn({ searchParams }: SignInPageProps) {
  return renderAuthEntry("signIn", searchParams);
}
