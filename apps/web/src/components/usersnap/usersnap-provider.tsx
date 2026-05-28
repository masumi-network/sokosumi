"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";
import { UsersnapContext } from "./usersnap-context";
import { isUsersnapWidgetLoadFailure } from "./usersnap-errors";

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
      setUsersnapApi(null);
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
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (isUsersnapWidgetLoadFailure(error)) {
          console.warn("Usersnap widget failed to load:", error);
          setUsersnapApi(null);
          return;
        }

        console.error("Unexpected Usersnap initialization error:", error);
        setUsersnapApi(null);
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
