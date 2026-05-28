"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";

import { UsersnapContext } from "./usersnap-context";

interface SessionUser {
  id: string;
  email: string;
}

function buildUsersnapInitOptions(user: SessionUser | undefined) {
  if (!user) {
    return {};
  }

  return {
    user: {
      email: user.email,
      userId: user.id,
    },
  };
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
  const sessionUser = session?.user;

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

        setUsersnapApi(api);
      })
      .catch(() => {
        // Usersnap is optional; invalid API key or paused project must not
        // become an unhandled rejection (Sentry SOKOSUMI-C).
      });

    return () => {
      cancelled = true;
    };
  }, [usersnapSpaceApiKey]);

  useEffect(() => {
    if (!usersnapApi) {
      return;
    }

    usersnapApi.init(buildUsersnapInitOptions(sessionUser));
  }, [usersnapApi, sessionUser]);

  return (
    <UsersnapContext.Provider value={usersnapApi}>
      {children}
    </UsersnapContext.Provider>
  );
};
