import { FilePlus2, PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { ShipmentFilters } from "@/components/shipments/shipment-filters";
import { ShipmentTable } from "@/components/shipments/shipment-table";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { ShipmentStatus } from "@/domain/snapshot";
import { listShipments, listSuppliers } from "@/server/queries/shipments";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Shipments · Customs cross-check" };

// Unknown or malformed filter values are ignored rather than treated as errors (URLs get hand-edited and shared).
const Filters = z.object({
  status: ShipmentStatus.optional().catch(undefined),
  supplier: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(50).optional().catch(undefined),
});

export default async function ShipmentsPage(props: PageProps<"/shipments">) {
  await requireUser();
  const raw = await props.searchParams;
  const f = Filters.parse({ status: raw.status, supplier: raw.supplier, q: raw.q });
  const [rows, suppliers] = await Promise.all([listShipments({ status: f.status, supplierId: f.supplier, q: f.q || undefined }), listSuppliers()]);
  const filtered = Boolean(f.status || f.supplier || f.q);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-balance">Shipments</h1>
          <p className="text-sm text-muted-foreground">
            <Num value={String(rows.length)} /> {filtered ? "matching" : rows.length === 1 ? "shipment" : "shipments"}, most recently changed first
          </p>
        </div>
        <Button asChild>
          <Link href="/shipments/new">
            <FilePlus2 aria-hidden /> New shipment
          </Link>
        </Button>
      </header>

      <ShipmentFilters suppliers={suppliers} />

      {rows.length > 0 ? (
        <ShipmentTable rows={rows} />
      ) : filtered ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <h2 className="font-medium">No shipments match these filters</h2>
          <p className="text-sm text-muted-foreground">Search looks at shipment refs and invoice numbers. Try fewer filters.</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/shipments">Clear filters</Link>
          </Button>
        </section>
      ) : (
        <section className="flex flex-col items-start gap-4 rounded-lg border border-dashed p-8">
          <PackageOpen aria-hidden className="size-8 text-muted-foreground" />
          <div className="max-w-prose space-y-1">
            <h2 className="font-medium">No shipments yet</h2>
            <p className="text-sm text-muted-foreground text-pretty">
              A shipment holds one invoice, packing list and bill of lading. Upload them and every field is read, scored and cross-checked
              before anything is filed. A sample set shows the whole flow with bundled documents.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/shipments/new">
                <FilePlus2 aria-hidden /> New shipment
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/shipments/new#samples">Load a sample set</Link>
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
