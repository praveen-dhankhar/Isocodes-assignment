import { D, formatEnIn } from "../../money";
import { readyDocument } from "../../snapshot";
import { observe, outcome } from "../fingerprint";
import type { CheckRule } from "../types";

const money = (d: D) => formatEnIn(d.toFixed(2));

const LINE_PARTS = ["quantity", "unitPrice", "lineTotal"] as const;
const PART_LABEL = { quantity: "quantity", unitPrice: "unit price", lineTotal: "line total" } as const;

/** CC-01: each invoice line, quantity × unit price vs line total, |Δ| ≤ money tolerance. */
export const lineTotals: CheckRule = {
  id: "CC-01",
  name: "LINE_TOTALS",
  run(snapshot, config) {
    const invoice = readyDocument(snapshot, "INVOICE");
    if (!invoice) return [];
    return invoice.lines.map(({ lineNo, cells }) => {
      const base = {
        ruleId: "CC-01" as const,
        scope: `line:${lineNo}`,
        observed: LINE_PARTS.map((part) => observe("INVOICE", cells[part])),
        notes: [],
      };
      const quantity = cells.quantity?.value;
      const unitPrice = cells.unitPrice?.value;
      const lineTotal = cells.lineTotal?.value;
      if (quantity == null || unitPrice == null || lineTotal == null) {
        const missing = LINE_PARTS.filter((part) => cells[part]?.value == null).map((part) => PART_LABEL[part]);
        return outcome({ ...base, status: "INCOMPLETE", delta: null, message: `Line ${lineNo}: ${missing.join(", ")} missing` });
      }
      const product = new D(quantity).times(unitPrice);
      const delta = product.minus(lineTotal).abs();
      const sum = `Line ${lineNo}: ${formatEnIn(quantity)} × ${formatEnIn(unitPrice)} = ${money(product)}`;
      return delta.lte(config.moneyTolerance)
        ? outcome({ ...base, status: "PASS", delta: delta.toFixed(2), message: sum })
        : outcome({ ...base, status: "FAIL", delta: delta.toFixed(2), message: `${sum}, but the line total is ${formatEnIn(lineTotal)}` });
    });
  },
};

/** CC-02: Σ round₂(quantity × unit price) over invoice lines vs invoice total, |Δ| ≤ money tolerance. */
export const invoiceTotal: CheckRule = {
  id: "CC-02",
  name: "INVOICE_TOTAL",
  run(snapshot, config) {
    const invoice = readyDocument(snapshot, "INVOICE");
    if (!invoice) return [];
    const total = invoice.header.invoiceTotal;
    const base = { ruleId: "CC-02" as const, scope: "shipment", notes: [] };
    const incomplete = (message: string) => [outcome({ ...base, status: "INCOMPLETE", observed: [observe("INVOICE", total)], delta: null, message })];

    // PRD §6.2: no lines can only be fixed by adding them, never acknowledged.
    if (invoice.lines.length === 0) return incomplete("No line items");
    if (total?.value == null) return incomplete("Invoice total missing");
    let sum = new D(0);
    for (const { lineNo, cells } of invoice.lines) {
      const quantity = cells.quantity?.value;
      const unitPrice = cells.unitPrice?.value;
      if (quantity == null || unitPrice == null) return incomplete(`Line ${lineNo}: quantity or unit price missing`);
      sum = sum.plus(new D(quantity).times(unitPrice).toDecimalPlaces(2));
    }

    const delta = sum.minus(total.value).abs();
    const observed = [observe("INVOICE", total), { docType: "INVOICE" as const, fieldId: null, value: sum.toFixed(2), display: `Σ lines ${money(sum)}` }];
    return delta.lte(config.moneyTolerance)
      ? [outcome({ ...base, observed, status: "PASS", delta: delta.toFixed(2), message: `Invoice total ${formatEnIn(total.value)} matches the sum of line amounts` })]
      : [outcome({ ...base, observed, status: "FAIL", delta: delta.toFixed(2), message: `Invoice total ${formatEnIn(total.value)} differs from the sum of line amounts ${money(sum)}` })];
  },
};
