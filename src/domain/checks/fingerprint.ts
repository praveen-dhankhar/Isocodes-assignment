import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { formatEnIn } from "../money";
import type { DocType } from "../fields";
import type { FieldRef } from "../snapshot";
import type { CheckOutcome, CheckSeverity, CheckStatus, ObservedValue, RuleId } from "./types";

const SEVERITY: Record<CheckStatus, CheckSeverity> = {
  PASS: "INFO",
  FAIL: "CRITICAL",
  INCOMPLETE: "WARNING",
  NOT_APPLICABLE: "INFO",
};

/**
 * sha256(rule | scope | sorted observed values), first 16 hex chars (ARCHITECTURE §6.3). Display text is left out,
 * so only a change in what the documents say re-opens a resolved check. Pure JS SHA-256 keeps the domain platform-free.
 */
export function fingerprint(o: { ruleId: RuleId; scope: string; observed: readonly ObservedValue[] }): string {
  const values = o.observed.map((v) => `${v.docType}=${v.value ?? ""}`).sort();
  return bytesToHex(sha256(utf8ToBytes([o.ruleId, o.scope, ...values].join("|")))).slice(0, 16);
}

/** A rule's result: severity follows status (PRD §9); runCrossChecks attaches any carried-over resolution. */
export function outcome(draft: Omit<CheckOutcome, "severity" | "fingerprint" | "resolution">): CheckOutcome {
  return { ...draft, severity: SEVERITY[draft.status], fingerprint: fingerprint(draft), resolution: null };
}

/** `show` formats a present value for people; numbers by default, text and codes pass `asPrinted`. */
export function observe(docType: DocType, ref: FieldRef | undefined, show: (value: string) => string = formatEnIn): ObservedValue {
  const value = ref?.value ?? null;
  return { docType, fieldId: ref?.fieldId ?? null, value, display: value === null ? "not stated" : show(value) };
}

export const asPrinted = (value: string) => value;
