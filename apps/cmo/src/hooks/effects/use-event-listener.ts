"use client";

import { useEffect, useEffectEvent } from "react";

export type EventListenerTarget =
  | "window"
  | "document"
  | Window
  | Document
  | HTMLElement
  | EventTarget
  | null
  | undefined;

function resolveTarget(target: EventListenerTarget): EventTarget | null {
  if (!target) return null;
  if (target === "window") {
    return typeof window === "undefined" ? null : window;
  }
  if (target === "document") {
    return typeof document === "undefined" ? null : document;
  }
  return target;
}

export function useEventListener<K extends keyof WindowEventMap>(
  target: "window" | Window | null | undefined,
  event: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
  target: "document" | Document | null | undefined,
  event: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function useEventListener<
  K extends keyof HTMLElementEventMap,
  T extends HTMLElement = HTMLElement,
>(
  target: T | null | undefined,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function useEventListener(
  target: EventListenerTarget,
  event: string,
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function useEventListener(
  target: EventListenerTarget,
  event: string,
  handler: (event: never) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  const onEvent = useEffectEvent(handler);
  const isBooleanOptions = typeof options === "boolean";
  const capture = isBooleanOptions ? options : options?.capture;
  const passive = isBooleanOptions ? undefined : options?.passive;
  const once = isBooleanOptions ? undefined : options?.once;
  const signal = isBooleanOptions ? undefined : options?.signal;

  useEffect(() => {
    const resolved = resolveTarget(target);
    if (!resolved) return;

    const listener: EventListener = (evt) => {
      onEvent(evt as never);
    };

    let listenerOptions: boolean | AddEventListenerOptions | undefined;
    if (isBooleanOptions) {
      listenerOptions = capture;
    } else if (
      capture !== undefined ||
      passive !== undefined ||
      once !== undefined ||
      signal !== undefined
    ) {
      listenerOptions = {};
      if (capture !== undefined) listenerOptions.capture = capture;
      if (passive !== undefined) listenerOptions.passive = passive;
      if (once !== undefined) listenerOptions.once = once;
      if (signal !== undefined) listenerOptions.signal = signal;
    }

    if (listenerOptions === undefined) {
      resolved.addEventListener(event, listener);
    } else {
      resolved.addEventListener(event, listener, listenerOptions);
    }

    return () => {
      if (capture === undefined) {
        resolved.removeEventListener(event, listener);
      } else {
        resolved.removeEventListener(event, listener, capture);
      }
    };
  }, [target, event, isBooleanOptions, capture, passive, once, signal]);
}
