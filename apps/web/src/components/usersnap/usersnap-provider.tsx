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

    let cancelled = false;

    loadSpace(usersnapSpaceApiKey)
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
      .catch(() => {
        // @usersnap/browser rejects with a string when the widget script fails
        // (invalid key, paused project, blocked by ad blockers, etc.). Feedback
        // is optional; swallow so Sentry does not report unhandled rejections.
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
