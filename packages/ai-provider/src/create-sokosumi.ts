import type { LanguageModelV3 } from "@ai-sdk/provider";

import {
  createSokosumiLanguageModel,
  type SokosumiLanguageModel,
} from "./sokosumi-language-model.js";
import type { CreateSokosumiOptions } from "./types.js";

export interface SokosumiProvider {
  (modelId: string): SokosumiLanguageModel;
  languageModel: (modelId: string) => SokosumiLanguageModel;
}

export function createSokosumi(
  options: CreateSokosumiOptions,
): SokosumiProvider {
  function factory(modelId: string): SokosumiLanguageModel {
    return createSokosumiLanguageModel(modelId, options);
  }
  factory.languageModel = factory;
  return factory as SokosumiProvider;
}

export function isSokosumiLanguageModel(
  model: LanguageModelV3,
): model is SokosumiLanguageModel {
  return model.provider === "sokosumi";
}
