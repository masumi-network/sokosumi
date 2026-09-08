/**
 * Who owns the room's scroll position while a jump is running.
 *
 * Two jumps can be in flight at once: a reader clearing a list of
 * notifications clicks a second one while the first is still loading its
 * window. Both carry the same room, so the room check the rest of the client
 * uses cannot tell them apart.
 *
 * Two different questions come out of that, and keeping them apart is the
 * whole point of this file.
 *
 * `isNewestJump` asks whether this jump still speaks for the reader. It gates
 * everything that would move the room: the highlight, and the window merges
 * behind it. A jump the reader has replaced must not scroll them off the
 * message they asked for last.
 *
 * The hold asks who took it, because only the jump holding it can give it
 * back. Recency is the wrong test here, and using it strands the hold. A room
 * jump whose target is already on screen highlights it and returns before
 * taking any hold, so it replaces the holder without becoming one; if recency
 * decided, the jump still holding would no longer be allowed to release, and
 * the room would stay off the bottom, following nothing, until a room switch
 * cleared the flag. A thread jump takes the hold first and does not have that
 * shape, which is exactly why the rule cannot be read off either caller.
 */
export interface RoomJumpState {
  /** Bumped by every jump. The highest one speaks for the reader. */
  generation: number;
  /** The generation holding the room off the bottom, or 0 for none. */
  holdOwner: number;
}

export interface RoomJumpHoldDeps {
  /** Still the room this jump was started for. */
  isStillSelectedRoom: () => boolean;
  hold: () => void;
  release: () => void;
}

export interface RoomJump {
  isNewestJump: () => boolean;
  holdOffBottom: () => void;
  releaseHoldOffBottom: () => void;
}

export function createRoomJumpState(): RoomJumpState {
  return { generation: 0, holdOwner: 0 };
}

/**
 * Start one jump against the shared state.
 *
 * The room is checked on both the take and the release, and the two have to
 * agree: a hold taken for a room the reader has left is not released by this
 * jump, so the room they moved to would stop following new messages.
 */
export function startRoomJump(
  state: RoomJumpState,
  deps: RoomJumpHoldDeps,
): RoomJump {
  state.generation += 1;
  const generation = state.generation;

  return {
    isNewestJump: () => generation === state.generation,
    holdOffBottom: () => {
      if (!deps.isStillSelectedRoom()) {
        return;
      }
      state.holdOwner = generation;
      deps.hold();
    },
    releaseHoldOffBottom: () => {
      if (!deps.isStillSelectedRoom() || state.holdOwner !== generation) {
        return;
      }
      state.holdOwner = 0;
      deps.release();
    },
  };
}
