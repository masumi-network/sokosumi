"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";

import { UsersnapContext } from "./usersnap-context";

function getUsersnapLoadFailureMessage(reason: unknown): string | null {
  if (typeof reason === "string") {
    return reason.startsWith("Failed to load the widget") ? reason : null;
  }

  if (reason instanceof Error) {
    return reason.message.startsWith("Failed to load the widget")
      ? reason.message
      : null;
  }

  return null;
}

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
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }

        const message = getUsersnapLoadFailureMessage(reason);
        if (message) {
          console.warn("Usersnap widget failed to load:", message);
          return;
        }

        console.error("Usersnap widget failed to load:", reason);
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
