"use client";

import { useEffect, useRef } from "react";

import {
  formatChatUnreadDocumentTitle,
  stripChatUnreadTitlePrefix,
} from "@/components/chat/chat-unread-document-title";

export function useChatUnreadDocumentTitle(unreadTotal: number): void {
  const unreadTotalRef = useRef(unreadTotal);
  unreadTotalRef.current = unreadTotal;

  useEffect(() => {
    let isSelfWrite = false;

    function applyTitle() {
      const nextTitle = formatChatUnreadDocumentTitle(
        document.title,
        unreadTotalRef.current,
      );
      if (nextTitle === document.title) {
        return;
      }
      isSelfWrite = true;
      document.title = nextTitle;
      queueMicrotask(() => {
        isSelfWrite = false;
      });
    }

    applyTitle();

    const titleElement = document.querySelector("title");
    const observer = new MutationObserver(() => {
      if (isSelfWrite) {
        return;
      }
      applyTitle();
    });

    if (titleElement) {
      observer.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    return () => {
      observer.disconnect();
      isSelfWrite = true;
      document.title = stripChatUnreadTitlePrefix(document.title);
    };
  }, [unreadTotal]);
}
