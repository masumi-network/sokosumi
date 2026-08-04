"use client";

import { useEffect, useRef } from "react";

import {
  formatChatUnreadDocumentTitle,
  stripChatUnreadTitlePrefix,
} from "@/components/chat/chat-unread-document-title";

function getDocumentTitleDescriptor(target: Document): PropertyDescriptor & {
  get: (this: Document) => string;
  set: (this: Document, value: string) => void;
} {
  let owner: object | null = target;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, "title");
    if (descriptor?.get && descriptor.set) {
      return descriptor as PropertyDescriptor & {
        get: (this: Document) => string;
        set: (this: Document, value: string) => void;
      };
    }
    owner = Object.getPrototypeOf(owner);
  }
  throw new Error("document.title descriptor unavailable");
}

export function useChatUnreadDocumentTitle(unreadTotal: number): void {
  const unreadTotalRef = useRef(unreadTotal);
  unreadTotalRef.current = unreadTotal;

  useEffect(() => {
    let isSelfWrite = false;
    const descriptor = getDocumentTitleDescriptor(document);

    function writeTitle(nextTitle: string) {
      if (nextTitle === descriptor.get.call(document)) {
        return;
      }
      isSelfWrite = true;
      descriptor.set.call(document, nextTitle);
      queueMicrotask(() => {
        isSelfWrite = false;
      });
    }

    function applyTitle(baseTitle = descriptor.get.call(document)) {
      writeTitle(
        formatChatUnreadDocumentTitle(baseTitle, unreadTotalRef.current),
      );
    }

    Object.defineProperty(document, "title", {
      configurable: true,
      enumerable: true,
      get() {
        return descriptor.get.call(document);
      },
      set(value: string) {
        writeTitle(
          formatChatUnreadDocumentTitle(value, unreadTotalRef.current),
        );
      },
    });

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
      Reflect.deleteProperty(document, "title");
      writeTitle(stripChatUnreadTitlePrefix(descriptor.get.call(document)));
    };
  }, []);

  useEffect(() => {
    const nextTitle = formatChatUnreadDocumentTitle(
      document.title,
      unreadTotal,
    );
    if (nextTitle !== document.title) {
      document.title = nextTitle;
    }
  }, [unreadTotal]);
}
