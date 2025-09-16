import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";

import OnboardingForm from "./components/onboarding-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Onboarding.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function OnboardingPage() {
  const session = await getSession();
  const t = await getTranslations("Onboarding.Metadata");

  if (!session) {
    redirect("/login");
  }

  // Check if user has already completed onboarding
  console.log(
    "session.user.onboardingCompleted",
    session.user.onboardingCompleted,
  );
  if (session.user.onboardingCompleted) {
    redirect("/agents");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="mb-4 text-3xl font-bold">{t("title")}</h1>
          <p className="text-gray-600">{t("description")}</p>
        </div>

        <OnboardingForm userId={session.user.id} />
      </div>
    </div>
  );
}
