/**
 * Get suggestions based on coworker ID
 */
export function getCoworkerSuggestions(coworkerId?: string): string[] {
  if (!coworkerId) return [];

  const suggestionMap: Record<string, string[]> = {
    hannah: [
      "How can I analyze data effectively?",
      "What are the best practices for data visualization?",
      "How do I identify trends in my data?",
      "What statistical methods should I use?",
    ],
    john: [
      "How can I improve my code quality?",
      "What are common debugging techniques?",
      "How do I write more maintainable code?",
      "What's the best way to structure my project?",
    ],
    demosthenes: [
      "How can I write more clearly?",
      "What makes a good professional email?",
      "How do I structure a compelling proposal?",
      "What are tips for better business writing?",
    ],
  };

  return suggestionMap[coworkerId] || [];
}

/**
 * Get coworker image URL by ID
 */
export function getCoworkerImageUrl(coworkerId: string): string | null {
  const imageMap: Record<string, string> = {
    hannah: "/images/coworkers/hannah.png",
    demosthenes: "/images/coworkers/demosthenes.png",
  };
  return imageMap[coworkerId] || null;
}
