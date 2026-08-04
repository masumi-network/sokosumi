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

// Survives hook remounts during soft navigations so an empty <title> mid-swap
// cannot fall back to the browser host / a generic default.
let sharedLastGoodBase = "Sokosumi";

export function useChatUnreadDocumentTitle(unreadTotal: number): void {
  const unreadTotalRef = useRef(unreadTotal);
  unreadTotalRef.current = unreadTotal;

  useEffect(() => {
    let isSelfWrite = false;
    const descriptor = getDocumentTitleDescriptor(document);
    const initialBase = stripChatUnreadTitlePrefix(
      descriptor.get.call(document),
    ).trim();
    if (initialBase) {
      sharedLastGoodBase = initialBase;
    }

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

    function rememberBase(rawTitle: string) {
      const base = stripChatUnreadTitlePrefix(rawTitle).trim();
      if (base) {
        sharedLastGoodBase = base;
      }
    }

    function applyTitle(rawTitle = descriptor.get.call(document)) {
      rememberBase(rawTitle);
      writeTitle(
        formatChatUnreadDocumentTitle(
          sharedLastGoodBase,
          unreadTotalRef.current,
        ),
      );
    }

    Object.defineProperty(document, "title", {
      configurable: true,
      enumerable: true,
      get() {
        return descriptor.get.call(document);
      },
      set(value: string) {
        rememberBase(value);
        writeTitle(
          formatChatUnreadDocumentTitle(
            sharedLastGoodBase,
            unreadTotalRef.current,
          ),
        );
      },
    });

    applyTitle();

    const observer = new MutationObserver(() => {
      if (isSelfWrite) {
        return;
      }
      applyTitle();
    });

    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });

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
