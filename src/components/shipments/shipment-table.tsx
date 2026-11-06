import Link from "next/link";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShipmentListRow } from "@/server/queries/shipments";
import { formatDateTime } from "./format";
import { ShipmentStatusBadge } from "./status-badge";

const Mismatches = ({ n }: { n: number }) =>
  n > 0 ? (
    <StateBadge state="mismatch">
      <Num value={String(n)} /> {n === 1 ? "mismatch" : "mismatches"}
    </StateBadge>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const Issues = ({ n }: { n: number }) => <Num value={String(n)} className={n === 0 ? "text-muted-foreground" : "font-medium"} />;

/** S2: a table from 768 px, cards below it. The ref is the link; the whole row is its hit area. */
export function ShipmentTable({ rows }: { rows: ShipmentListRow[] }) {
  return (
    <div>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Importer</TableHead>
              <TableHead className="text-right">Docs</TableHead>
              <TableHead className="text-right">Unresolved</TableHead>
              <TableHead>Mismatches</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="relative">
                <TableCell>
                  <Link href={`/shipments/${r.id}`} className="rounded-sm font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50">
                    <Mono>{r.ref}</Mono>
                  </Link>
                  {r.invoiceNumber && <Mono className="block text-xs text-muted-foreground">{r.invoiceNumber}</Mono>}
                </TableCell>
                <TableCell>{r.supplier}</TableCell>
                <TableCell>{r.importer}</TableCell>
                <TableCell className="text-right">
                  <Num value={String(r.documentCount)} />
                  <span className="text-muted-foreground">/3</span>
                </TableCell>
                <TableCell className="text-right">
                  <Issues n={r.unresolvedIssuesCount} />
                </TableCell>
                <TableCell>
                  <Mismatches n={r.failedCheckCount} />
                </TableCell>
                <TableCell>
                  <ShipmentStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <time dateTime={r.updatedAt} className="tabular-nums">
                    {formatDateTime(r.updatedAt)}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y rounded-lg border md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/shipments/${r.id}`} className="flex flex-col gap-2 p-4 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
              <span className="flex items-center justify-between gap-2">
                <Mono className="font-medium">{r.ref}</Mono>
                <ShipmentStatusBadge status={r.status} />
              </span>
              <span className="text-sm">
                {r.supplier} <span className="text-muted-foreground">→</span> {r.importer}
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Docs <Num value={String(r.documentCount)} className="text-foreground" />/3
                </span>
                <span>
                  Unresolved <Issues n={r.unresolvedIssuesCount} />
                </span>
                {r.failedCheckCount > 0 && <Mismatches n={r.failedCheckCount} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
