"use client";

import { confirmField, setFieldValue } from "@/server/actions/review";
import type { FieldDTO } from "@/server/queries/review-model";
import { useReviewAction } from "./use-review-action";

export interface FieldActions {
  confirm: (field: FieldDTO) => Promise<void>;
  /** Returns an error message to show next to the input, or null when saved. */
  save: (field: FieldDTO, input: string) => Promise<string | null>;
  pending: boolean;
}

/** Confirm / Correct / Enter (PRD F3.3) against the field's version; a conflict reloads (useReviewAction). */
export function useFieldActions(): FieldActions {
  const { run, pending } = useReviewAction();
  return {
    pending,
    confirm: async (field) => {
      await run(confirmField, { fieldId: field.id, expectedFieldVersion: field.version });
    },
    save: async (field, input) => {
      const result = await run(setFieldValue, { fieldId: field.id, expectedFieldVersion: field.version, input });
      return result.ok || result.error.code === "VERSION_CONFLICT" ? null : result.error.message;
    },
  };
}
