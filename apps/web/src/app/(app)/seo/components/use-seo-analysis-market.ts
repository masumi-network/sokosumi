"use client";

import { useState } from "react";
import {
  changeSeoAnalysisMarket,
  editSeoAnalysisKeywords,
  initialSeoAnalysisMarket,
  type SeoAnalysisSavedKeyword,
  type SeoMarket,
  seoAnalysisKeywordDraft,
} from "./seo-analysis-market-model";

export function useSeoAnalysisMarket(
  keywords: readonly SeoAnalysisSavedKeyword[],
  /** The most saved keywords the chosen check type takes. */
  limit?: number,
  /** The market where no saved keyword names one. */
  fallback?: SeoMarket,
) {
  const [state, setState] = useState(() =>
    initialSeoAnalysisMarket(keywords, fallback),
  );
  return {
    countryCode: state.countryCode,
    languageCode: state.languageCode,
    keywords: seoAnalysisKeywordDraft(state, keywords, limit),
    setCountryCode: (countryCode: string) =>
      setState((previous) =>
        changeSeoAnalysisMarket(previous, { countryCode }),
      ),
    setLanguageCode: (languageCode: string) =>
      setState((previous) =>
        changeSeoAnalysisMarket(previous, { languageCode }),
      ),
    setKeywords: (value: string) =>
      setState((previous) => editSeoAnalysisKeywords(previous, value)),
  };
}
