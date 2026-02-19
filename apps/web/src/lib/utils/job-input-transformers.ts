import {
  type InputFieldSchemaType,
  type InputSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

export function getReadonlyNoneInputValues(
  inputFields: InputFieldSchemaType[],
): Record<string, string> {
  return Object.fromEntries(
    inputFields
      .filter((inputField) => inputField.type === InputType.NONE)
      .map((inputField) => [inputField.id, inputField.data?.description ?? ""])
      .filter((entry) => entry[1].length > 0),
  );
}

export function mergeReadonlyInputValues(
  transformedInputData: InputSchemaType,
  readonlyInputValues?: Record<string, string>,
  inputFieldIdsInOrder?: string[],
): InputSchemaType {
  if (!readonlyInputValues || Object.keys(readonlyInputValues).length === 0) {
    return transformedInputData;
  }

  const mergedInputData = {
    ...transformedInputData,
    ...readonlyInputValues,
  };

  if (!inputFieldIdsInOrder?.length) {
    return mergedInputData;
  }

  const orderedEntries = inputFieldIdsInOrder
    .filter((fieldId) => fieldId in mergedInputData)
    .map((fieldId) => [fieldId, mergedInputData[fieldId]] as const);
  const keysInSchemaOrder = new Set(inputFieldIdsInOrder);
  const extraEntries = Object.entries(mergedInputData).filter(
    ([key]) => !keysInSchemaOrder.has(key),
  );

  return Object.fromEntries([
    ...orderedEntries,
    ...extraEntries,
  ]) as InputSchemaType;
}
