"use client";
import Markdown from "markdown-to-jsx";
import { useEffect, useState } from "react";

export default function TermsPage() {
  const [markdownContent, setMarkdownContent] = useState<string>("");

  useEffect(() => {
    fetch("/files/terms-of-service.md")
      .then((response) => response.text())
      .then((text) => setMarkdownContent(text));
  }, []);
  return (
    <>
      <section className="prose dark:prose-invert max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2">
        <Markdown>{markdownContent}</Markdown>
      </section>
    </>
  );
}
