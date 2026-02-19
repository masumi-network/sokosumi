"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef } from "react";

interface UseChatScrollProps {
  messages: UIMessage[];
  isLoading: boolean;
  selectedChatId: string | null;
}

const NEAR_BOTTOM_THRESHOLD_PX = 120;

/** Auto-scroll to bottom when new messages arrive; respects user scroll-up. */
export function useChatScroll({
  messages,
  isLoading,
  selectedChatId,
}: UseChatScrollProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const userHasScrolledUpRef = useRef(false);

  const isNearBottom = useCallback((container: HTMLElement): boolean => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollTop + clientHeight >= scrollHeight - NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottomIfNear = useCallback(() => {
    if (!scrollAreaRef.current) return;
    if (userHasScrolledUpRef.current) return;
    const scrollContainer = scrollAreaRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;
    if (!scrollContainer) return;
    if (isNearBottom(scrollContainer)) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [isNearBottom]);

  useEffect(() => {
    if (!isLoading) userHasScrolledUpRef.current = false;
  }, [isLoading]);

  useEffect(() => {
    userHasScrolledUpRef.current = false;
  }, [selectedChatId]);

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement | null;
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(scrollToBottomIfNear, 50);
      return () => clearInterval(interval);
    }
    scrollToBottom();
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [messages, isLoading, selectedChatId, scrollToBottomIfNear]);

  useEffect(() => {
    if (!selectedChatId || messages.length === 0) return;
    if (!scrollAreaRef.current) return;

    const scrollContainer = scrollAreaRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;

    if (!scrollContainer) return;

    const handleScroll = () => {
      userHasScrolledUpRef.current = !isNearBottom(scrollContainer);
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) userHasScrolledUpRef.current = true;
    };
    let lastTouchY: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || lastTouchY === null) return;
      const touchY = e.touches[0].clientY;
      if (touchY < lastTouchY) userHasScrolledUpRef.current = true;
      lastTouchY = touchY;
    };
    const handleTouchEnd = () => {
      lastTouchY = null;
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    scrollContainer.addEventListener("touchmove", handleTouchMove, {
      passive: true,
    });
    scrollContainer.addEventListener("touchend", handleTouchEnd, {
      passive: true,
    });

    const onMutation = () => {
      requestAnimationFrame(() => {
        if (userHasScrolledUpRef.current) return;
        if (isNearBottom(scrollContainer)) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    };

    const observer = new MutationObserver(onMutation);

    observer.observe(scrollContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      observer.disconnect();
    };
  }, [selectedChatId, messages.length, isNearBottom]);

  return { scrollAreaRef, scrollToBottom };
}
