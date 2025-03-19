import { getSession } from "@/lib/auth";

import UserAvatarClient from "./user-avatar.client";

export default async function UserAvatar() {
  const session = await getSession();

  return <UserAvatarClient user={session.user} />;
}
