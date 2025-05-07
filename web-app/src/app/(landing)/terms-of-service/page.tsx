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
      <section className="prose mx-auto max-w-1/2 p-6 pt-8">
        <Markdown>{markdownContent}</Markdown>
      </section>
    </>
  );
}
