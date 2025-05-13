"use client";
import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";

import { UsersnapContext } from "./usersnap-context";

const USERSNAP_SPACE_API_KEY = "47863920-74cf-4d78-a138-932773f40a47";

export const UsersnapProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [usersnapApi, setUsersnapApi] = useState<SpaceApi | null>(null);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    loadSpace(USERSNAP_SPACE_API_KEY).then((api) => {
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
  }, [session]);

  return (
    <UsersnapContext.Provider value={usersnapApi}>
      {children}
    </UsersnapContext.Provider>
  );
};
