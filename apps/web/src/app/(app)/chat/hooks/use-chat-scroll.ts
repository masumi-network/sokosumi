"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";

interface UseChatScrollProps {
  messages: UIMessage[];
  isLoading: boolean;
  selectedChatId: string | null;
}

/**
 * Hook to handle auto-scrolling to bottom when new messages arrive
 */
export function useChatScroll({
  messages,
  isLoading,
  selectedChatId,
}: UseChatScrollProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
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

    // Scroll immediately
    scrollToBottom();

    // Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      scrollToBottom();
    });

    // During streaming, continuously scroll to bottom more aggressively
    if (isLoading) {
      const interval = setInterval(() => {
        scrollToBottom();
      }, 50); // Check every 50ms during streaming for smoother updates

      return () => clearInterval(interval);
    }
  }, [messages, isLoading, selectedChatId]);

  // Also use MutationObserver to catch DOM changes during streaming
  useEffect(() => {
    if (!selectedChatId || messages.length === 0) return;
    if (!scrollAreaRef.current) return;

    const scrollContainer = scrollAreaRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;

    if (!scrollContainer) return;

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };

    const observer = new MutationObserver(() => {
      requestAnimationFrame(scrollToBottom);
    });

    observer.observe(scrollContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [selectedChatId, messages.length]);

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

  return { scrollAreaRef, scrollToBottom };
}
