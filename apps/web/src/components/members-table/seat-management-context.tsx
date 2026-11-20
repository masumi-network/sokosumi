"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffectEvent,
  useRef,
  useState,
} from "react";

interface SeatManagementContextValue {
  showSeatManagement: boolean;
  unusedSeats: number;
  isMemberSeatAssigned: (
    memberId: string,
    hasSeatFromServer: boolean,
  ) => boolean;
  tryBeginSeatAssign: (memberId: string) => boolean;
  cancelSeatAssign: (memberId: string) => void;
  notifySeatUnassigned: (memberId: string) => void;
}

const SeatManagementContext = createContext<SeatManagementContextValue>({
  showSeatManagement: false,
  unusedSeats: 0,
  isMemberSeatAssigned: (_memberId, hasSeatFromServer) => hasSeatFromServer,
  tryBeginSeatAssign: () => false,
  cancelSeatAssign: () => {},
  notifySeatUnassigned: () => {},
});

interface SeatOptimisticState {
  pendingAssignCount: number;
  pendingUnassignCount: number;
  optimisticallyAssignedMemberIds: Set<string>;
  optimisticallyUnassignedMemberIds: Set<string>;
}

function createInitialOptimisticState(): SeatOptimisticState {
  return {
    pendingAssignCount: 0,
    pendingUnassignCount: 0,
    optimisticallyAssignedMemberIds: new Set(),
    optimisticallyUnassignedMemberIds: new Set(),
  };
}

function computeUnusedSeats(
  serverUnusedSeats: number,
  state: SeatOptimisticState,
): number {
  return Math.max(
    0,
    serverUnusedSeats - state.pendingAssignCount + state.pendingUnassignCount,
  );
}

export function SeatManagementContextProvider({
  children,
  showSeatManagement,
  unusedSeats: serverUnusedSeats,
}: {
  children: ReactNode;
  showSeatManagement: boolean;
  unusedSeats: number;
}) {
  const [optimisticState, setOptimisticState] = useState<SeatOptimisticState>(
    createInitialOptimisticState,
  );
  // Seat handlers read and write a same-tick pending ref, not a setState
  // updater: React may defer an updater to the next render, so a value it sets
  // is not there when the handler returns. `useEffectEvent` reads committed
  // values only, so a discarded render cannot leave them stale.
  const pendingStateRef = useRef<{
    baseOptimisticState: SeatOptimisticState;
    baseServerUnusedSeats: number;
    current: SeatOptimisticState;
  } | null>(null);
  const [syncedServerUnusedSeats, setSyncedServerUnusedSeats] =
    useState(serverUnusedSeats);

  if (serverUnusedSeats !== syncedServerUnusedSeats) {
    setSyncedServerUnusedSeats(serverUnusedSeats);
    setOptimisticState(createInitialOptimisticState());
  }

  const getCommittedSnapshot = useEffectEvent(() => ({
    optimisticState,
    serverUnusedSeats,
  }));

  function readLatestState() {
    const committed = getCommittedSnapshot();
    const pending = pendingStateRef.current;
    const latestOptimisticState =
      pending !== null &&
      pending.baseOptimisticState === committed.optimisticState &&
      pending.baseServerUnusedSeats === committed.serverUnusedSeats
        ? pending.current
        : committed.optimisticState;
    return {
      committed,
      optimisticState: latestOptimisticState,
    };
  }

  function updateOptimisticState(
    next: (prev: SeatOptimisticState) => SeatOptimisticState,
  ): void {
    const { committed, optimisticState: prev } = readLatestState();
    const nextState = next(prev);
    pendingStateRef.current = {
      baseOptimisticState: committed.optimisticState,
      baseServerUnusedSeats: committed.serverUnusedSeats,
      current: nextState,
    };
    setOptimisticState(nextState);
  }

  const unusedSeats = computeUnusedSeats(serverUnusedSeats, optimisticState);

  function isMemberSeatAssigned(
    memberId: string,
    hasSeatFromServer: boolean,
  ): boolean {
    if (optimisticState.optimisticallyAssignedMemberIds.has(memberId)) {
      return true;
    }
    if (optimisticState.optimisticallyUnassignedMemberIds.has(memberId)) {
      return false;
    }
    return hasSeatFromServer;
  }

  function tryBeginSeatAssign(memberId: string): boolean {
    const { committed, optimisticState: prev } = readLatestState();
    if (
      computeUnusedSeats(committed.serverUnusedSeats, prev) <= 0 ||
      prev.optimisticallyAssignedMemberIds.has(memberId)
    ) {
      return false;
    }

    updateOptimisticState((current) => ({
      ...current,
      pendingAssignCount: current.pendingAssignCount + 1,
      optimisticallyAssignedMemberIds: new Set(
        current.optimisticallyAssignedMemberIds,
      ).add(memberId),
    }));
    return true;
  }

  function cancelSeatAssign(memberId: string): void {
    updateOptimisticState((prev) => {
      if (!prev.optimisticallyAssignedMemberIds.has(memberId)) {
        return prev;
      }

      const nextAssigned = new Set(prev.optimisticallyAssignedMemberIds);
      nextAssigned.delete(memberId);
      return {
        ...prev,
        pendingAssignCount: Math.max(0, prev.pendingAssignCount - 1),
        optimisticallyAssignedMemberIds: nextAssigned,
      };
    });
  }

  function notifySeatUnassigned(memberId: string): void {
    updateOptimisticState((prev) => ({
      ...prev,
      pendingUnassignCount: prev.pendingUnassignCount + 1,
      optimisticallyUnassignedMemberIds: new Set(
        prev.optimisticallyUnassignedMemberIds,
      ).add(memberId),
    }));
  }

  return (
    <SeatManagementContext
      value={{
        showSeatManagement,
        unusedSeats,
        isMemberSeatAssigned,
        tryBeginSeatAssign,
        cancelSeatAssign,
        notifySeatUnassigned,
      }}
    >
      {children}
    </SeatManagementContext>
  );
}

export function useSeatManagementContext(): SeatManagementContextValue {
  return useContext(SeatManagementContext);
}
