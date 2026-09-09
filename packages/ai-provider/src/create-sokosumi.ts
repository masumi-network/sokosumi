import {
  createSokosumiLanguageModel,
  type SokosumiLanguageModel,
} from "./sokosumi-language-model.js";
import type { CreateSokosumiOptions } from "./types.js";

export interface SokosumiProvider {
  (modelId: string | null): SokosumiLanguageModel;
  languageModel: (modelId: string | null) => SokosumiLanguageModel;
}

export function createSokosumi(
  options: CreateSokosumiOptions,
): SokosumiProvider {
  function factory(modelId: string | null): SokosumiLanguageModel {
    return createSokosumiLanguageModel(modelId, options);
  }
  factory.languageModel = factory;
  return factory as SokosumiProvider;
}
