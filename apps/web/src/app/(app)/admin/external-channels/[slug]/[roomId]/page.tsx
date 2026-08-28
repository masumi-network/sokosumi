import { redirect } from "next/navigation";

interface LegacyExternalChannelDetailRedirectProps {
  params: Promise<{ slug: string; roomId: string }>;
}

export default async function LegacyExternalChannelDetailRedirect({
  params,
}: LegacyExternalChannelDetailRedirectProps) {
  const { roomId } = await params;
  redirect(`/admin/matched-channels/${roomId}`);
}
