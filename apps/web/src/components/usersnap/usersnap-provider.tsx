"use client";

import type { SpaceApi } from "@usersnap/browser";
import { loadSpace } from "@usersnap/browser";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth.client";
import { UsersnapContext } from "./usersnap-context";
import { isUsersnapWidgetLoadFailure } from "./usersnap-errors";

interface SessionData {
  user?: {
    id: string;
    email: string;
  };
}

function buildUsersnapInitOptions(session: SessionData | null | undefined) {
  const user = session?.user;
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

export function UsersnapProvider({
  children,
  usersnapSpaceApiKey,
}: {
  children: React.ReactNode;
  usersnapSpaceApiKey?: string | undefined;
}) {
  const [usersnapApi, setUsersnapApi] = useState<SpaceApi | null>(null);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!usersnapSpaceApiKey) {
      setUsersnapApi(null);
      return;
    }

    let cancelled = false;

    loadSpace(usersnapSpaceApiKey)
      .then((api) => {
        if (!cancelled) {
          setUsersnapApi(api);
        }
      })
      .catch((reason) => {
        if (!isUsersnapWidgetLoadFailure(reason)) {
          console.error("Usersnap failed to load", reason);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [usersnapSpaceApiKey]);

  useEffect(() => {
    if (!usersnapApi) {
      return;
    }

    usersnapApi.init(buildUsersnapInitOptions(session));
  }, [usersnapApi, session?.user?.email, session?.user?.id]);

  return (
    <UsersnapContext.Provider value={usersnapApi}>
      {children}
    </UsersnapContext.Provider>
  );
}
