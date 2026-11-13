"use client";

import {
  type AvatarOptions,
  type MountedAvatar,
  mountAvatar,
} from "open-bot-avatar/dom";
import { useEffect, useRef } from "react";

interface BotAvatarProps extends AvatarOptions {
  /** Width and height in pixels. */
  size: number;
}

/**
 * Mounts an open-bot-avatar into a square box. The first effect mounts once;
 * later renders pass changed options through `update`, which redraws only what
 * changed. Remount with a `key` to swap the definition.
 */
export function BotAvatar({ size, ...options }: BotAvatarProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<MountedAvatar | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const avatar = mountAvatar(host, optionsRef.current);
    avatarRef.current = avatar;
    return () => {
      avatar.destroy();
      avatarRef.current = null;
    };
  }, []);

  useEffect(() => {
    avatarRef.current?.update(options);
  });

  return <div ref={hostRef} style={{ width: size, height: size }} />;
}
