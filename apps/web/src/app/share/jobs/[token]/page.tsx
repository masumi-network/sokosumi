import { redirect } from "next/navigation";

// Reached by an external link, never by in-app navigation, so there is no
// prefetch to make instant. Blocking on the token lookup is the honest shape.
export const instant = false;

export default async function LegacySharedJobPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  redirect(`/share/${token}`);
}
