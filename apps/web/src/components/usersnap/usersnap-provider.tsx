"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";

import { UsersnapContext } from "./usersnap-context";

export const UsersnapProvider = ({
  children,
  usersnapSpaceApiKey,
}: {
  children: React.ReactNode;
  usersnapSpaceApiKey?: string | undefined;
}) => {
  const [usersnapApi, setUsersnapApi] = useState<SpaceApi | null>(null);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!usersnapSpaceApiKey) {
      return;
    }
    loadSpace(usersnapSpaceApiKey).then((api) => {
      let userPromps = {};
      const user = session?.user;
      if (user) {
        userPromps = {
          user: {
            email: user.email,
            userId: user.id,
          },
        };
      }
      api.init({
        ...userPromps,
      });
      setUsersnapApi(api);
    });
  }, [session, usersnapSpaceApiKey]);

  return (
    <UsersnapContext.Provider value={usersnapApi}>
      {children}
    </UsersnapContext.Provider>
  );
};
