import { DOC_LABEL, DocType, HEADER_FIELDS } from "../../fields";
import { iso6346Valid } from "../../normalize/codes";
import { identifierKey } from "../../normalize/text";
import { readyDocument } from "../../snapshot";
import { asPrinted, observe, outcome } from "../fingerprint";
import type { CheckRule } from "../types";

const showContainers = (value: string) => value.split("|").join(", ");

/** CC-07: the same container set on every extracted document that states one, and every number passes ISO 6346. */
export const containerNumbers: CheckRule = {
  id: "CC-07",
  name: "CONTAINER_NUMBERS",
  run(snapshot) {
    const docs = DocType.options.flatMap((docType) => {
      const doc = readyDocument(snapshot, docType);
      return doc ? [{ docType, ref: doc.header.containerNumbers, required: HEADER_FIELDS.containerNumbers.on[docType] === "R" }] : [];
    });
    const observed = docs.map((d) => observe(d.docType, d.ref, showContainers));
    const notes = docs.filter((d) => !d.required && d.ref?.value == null).map((d) => `${DOC_LABEL[d.docType]}: not stated`);
    const base = { ruleId: "CC-07" as const, scope: "shipment", observed, notes, delta: null };

    const missing = docs.filter((d) => d.required && d.ref?.value == null);
    if (missing.length > 0) {
      return [outcome({ ...base, status: "INCOMPLETE", message: `Container numbers missing on ${missing.map((d) => DOC_LABEL[d.docType]).join(", ")}` })];
    }

    const present = observed.flatMap((o) => (o.value === null ? [] : [{ ...o, value: o.value }]));
    const problems = present.flatMap((o) =>
      o.value.split("|").filter((code) => !iso6346Valid(code)).map((code) => `${code} on ${DOC_LABEL[o.docType]} fails the ISO 6346 check digit`),
    );
    const listed = present.map((o) => `${DOC_LABEL[o.docType]} ${o.display}`);
    // Canonical values are sorted and de-duplicated (PRD §7), so equal sets are equal strings.
    if (new Set(present.map((o) => o.value)).size > 1) problems.push(`container numbers differ: ${listed[0]} vs ${listed.slice(1).join(", ")}`);

    if (problems.length > 0) {
      const message = problems.join("; ");
      return [outcome({ ...base, status: "FAIL", message: message.charAt(0).toUpperCase() + message.slice(1) })];
    }
    if (present.length < 2) return [outcome({ ...base, status: "NOT_APPLICABLE", message: "Fewer than two documents state container numbers" })];
    return [outcome({ ...base, status: "PASS", message: `Container numbers agree: ${listed.join(", ")}` })];
  },
};

/** CC-08: the invoice number the packing list refers to matches the invoice (identifiers compare in uppercase). */
export const invoiceReference: CheckRule = {
  id: "CC-08",
  name: "INVOICE_REFERENCE",
  run(snapshot) {
    const invoice = readyDocument(snapshot, "INVOICE");
    const packing = readyDocument(snapshot, "PACKING_LIST");
    if (!invoice || !packing) return [];
    const number = invoice.header.invoiceNumber?.value;
    const reference = packing.header.invoiceNumber?.value;
    const base = {
      ruleId: "CC-08" as const,
      scope: "shipment",
      observed: [observe("INVOICE", invoice.header.invoiceNumber, asPrinted), observe("PACKING_LIST", packing.header.invoiceNumber, asPrinted)],
      notes: reference == null ? ["Packing list: not stated"] : [],
      delta: null,
    };
    if (number == null) return [outcome({ ...base, status: "INCOMPLETE", message: "Invoice number missing on Invoice" })];
    if (reference == null) return [outcome({ ...base, status: "NOT_APPLICABLE", message: "The packing list does not state an invoice number" })];
    return identifierKey(number) === identifierKey(reference)
      ? [outcome({ ...base, status: "PASS", message: `Packing list refers to invoice ${number}` })]
      : [outcome({ ...base, status: "FAIL", message: `Packing list refers to invoice ${reference}; the invoice is ${number}` })];
  },
};
