"use client";

import { Download, FileCheck2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReasonButton } from "@/components/ui/reason-button";
import { formatDateTime } from "@/components/shipments/format";
import type { ExportBlockReason } from "@/domain/status";

// API_SPECS §6.2 "Source" column, shown as a hint on each header cell.
const SOURCE: Record<string, string> = {
  SHIPMENT_REF: "Shipment", IMPORTER_NAME: "Importer master", IMPORTER_IEC: "Importer master", SUPPLIER_NAME: "Supplier master", SUPPLIER_COUNTRY: "Supplier master",
  INVOICE_NO: "Invoice", INVOICE_DATE: "Invoice", CURRENCY: "Invoice", INCOTERM: "Invoice", INVOICE_VALUE: "Invoice total", BL_NO: "Bill of lading",
  CONTAINER_NOS: "B/L > PL > INV", TOTAL_PACKAGES: "B/L > PL > INV, or declared", GROSS_WT_KG: "B/L > PL > INV, or declared", NET_WT_KG: "PL > INV > B/L, or declared",
  ITEM_SR_NO: "Invoice line", ITEM_DESCRIPTION: "Invoice line", HSN_CODE: "Invoice line", QUANTITY: "Invoice line, or declared", UQC: "Invoice line unit (A-21)",
  UNIT_PRICE: "Invoice line", ITEM_VALUE: "Invoice line total",
};

interface Props {
  shipmentId: string;
  status: string;
  version: number;
  reasons: ExportBlockReason[];
  unresolved: number;
  rows: string[][];
  history: Array<{ id: string; rowCount: number; layoutVersion: string; createdAt: string; by: string }>;
}

/** S6 (PRD F5): CF-1 rows as they will be filed, the gate's verdict in words, Excel or CSV download and earlier files. */
export function ExportPreview({ shipmentId, status, version, reasons, unresolved, rows, history }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [header = [], ...body] = rows;
  const blocked = status === "EXPORTED" ? "Already exported. A manager reopens it for a new export; earlier files are below." : reasons.length > 0 ? "Export is blocked; see why above" : null;
  const reasonText: Record<ExportBlockReason, { text: string; href: string; link: string }> = {
    UNRESOLVED_ISSUES: { text: `${unresolved} issue(s) are unresolved.`, href: `/shipments/${shipmentId}`, link: "Resolve them" },
    NOT_APPROVED: { text: "A manager has not approved it.", href: `/shipments/${shipmentId}/approval`, link: "Approval" },
    CHANGED_AFTER_APPROVAL: { text: "Data changed after approval; it must be approved again.", href: `/shipments/${shipmentId}/approval`, link: "Approval" },
    WRONG_STATUS: { text: "Only an approved shipment can be exported.", href: `/shipments/${shipmentId}/approval`, link: "Approval" },
  };

  async function download(format: "xlsx" | "csv") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, format }) });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message = (body as { error?: { message?: string } } | null)?.error?.message;
        setError(message ?? `Export failed (HTTP ${res.status}).`);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `export.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      {reasons.length > 0 && (
        <section aria-labelledby="blocked-heading" className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 id="blocked-heading" className="font-medium">Export is blocked</h2>
          <ul className="list-disc pl-5 text-sm">
            {reasons.map((r) => (
              <li key={r}>
                {reasonText[r].text}{" "}
                <Link className="underline underline-offset-4" href={reasonText[r].href}>
                  {reasonText[r].link}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">Layout CF-1 · {body.length} row(s), one per invoice line</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <ReasonButton reason={blocked} disabled={busy} onClick={() => void download("xlsx")}>
            <Download aria-hidden /> {busy ? "Exporting…" : "Export as Excel"}
          </ReasonButton>
          <ReasonButton variant="outline" reason={blocked} disabled={busy} onClick={() => void download("csv")}>
            Export as CSV
          </ReasonButton>
        </div>
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              {header.map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-mono font-medium whitespace-nowrap" title={SOURCE[h]}>
                  {h}
                  <span className="block font-sans font-normal text-muted-foreground">{SOURCE[h]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr key={i} className="border-t">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5 font-mono whitespace-nowrap tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="font-medium">Earlier exports</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <FileCheck2 aria-hidden className="size-4 text-muted-foreground" />
                <span>
                  {h.layoutVersion} · {h.rowCount} row(s) · {h.by} · <time className="tabular-nums">{formatDateTime(h.createdAt)}</time>
                </span>
                <span className="ml-auto flex gap-3">
                  <a className="underline underline-offset-4" href={`/api/shipments/${shipmentId}/exports/${h.id}?format=xlsx`} download>
                    Excel
                  </a>
                  <a className="underline underline-offset-4" href={`/api/shipments/${shipmentId}/exports/${h.id}?format=csv`} download>
                    CSV
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
