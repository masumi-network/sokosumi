import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { retrieveOrganizationWithRelationsById } from "@/lib/db/repositories/organization";

import SignUpForm from "./components/form";
import SignUpHeader from "./components/header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.Pages.SignUp.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

interface SignUpPageProps {
  searchParams: Promise<{ email?: string; organizationId?: string }>;
}

export default async function SignUp({ searchParams }: SignUpPageProps) {
  const { email, organizationId } = await searchParams;
  const prefilledOrganization = organizationId
    ? await retrieveOrganizationWithRelationsById(organizationId)
    : null;
  if (!!organizationId && !prefilledOrganization) {
    return notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      <SignUpHeader />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        {/* <SocialButtons /> */}
        <SignUpForm
          prefilledEmail={email}
          prefilledOrganization={prefilledOrganization}
        />
      </div>
    </div>
  );
}
