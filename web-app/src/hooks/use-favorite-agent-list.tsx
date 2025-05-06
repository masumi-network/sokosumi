"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth/auth.client";
import { AgentListWithAgent } from "@/lib/db";
import { getOrCreateFavoriteAgentList } from "@/lib/services";

export default function useFavoriteAgentList() {
  const { data: session } = useSession();

  const [favoriteAgentList, setFavoriteAgentList] = useState<
    AgentListWithAgent | undefined
  >(undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    const getCreateFavoriteAgentList = async () => {
      try {
        setFavoriteAgentList(undefined);
        setError(null);
        const favoriteAgentList = await getOrCreateFavoriteAgentList(
          session.user.id,
        );
        setFavoriteAgentList(favoriteAgentList);
      } catch (err) {
        if (err instanceof Error) {
          setError(err);
        } else {
          setError(new Error("An unknown error occurred while fetching jobs"));
        }
      }
    };

    getCreateFavoriteAgentList();
  }, [session]);

  return {
    favoriteAgentList,
    error,
  };
}
