"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";

import { isUsersnapLoadFailure } from "./is-usersnap-load-failure";
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

    let cancelled = false;

    void loadSpace(usersnapSpaceApiKey)
      .then((api) => {
        if (cancelled) {
          return;
        }

        const user = session?.user;
        api.init(
          user
            ? {
                user: {
                  email: user.email,
                  userId: user.id,
                },
              }
            : {},
        );
        setUsersnapApi(api);
      })
      .catch((reason: unknown) => {
        if (cancelled || !isUsersnapLoadFailure(reason)) {
          return;
        }
        // Invalid/paused Usersnap space: degrade silently (no feedback widget).
      });

    return () => {
      cancelled = true;
    };
  }, [session, usersnapSpaceApiKey]);

  return (
    <UsersnapContext.Provider value={usersnapApi}>
      {children}
    </UsersnapContext.Provider>
  );
};
