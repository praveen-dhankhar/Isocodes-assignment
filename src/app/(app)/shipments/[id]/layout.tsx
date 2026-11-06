import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ShipmentNav } from "@/components/shipments/shipment-nav";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { AppError } from "@/lib/errors";
import { getShipmentHeader } from "@/server/queries/shipments";
import { requireUser } from "@/server/session";

// Shared by S4, S5, S6 and S8: who, what state, how many issues, and the tabs between those screens.
export default async function ShipmentLayout(props: LayoutProps<"/shipments/[id]">) {
  await requireUser();
  const id = z.uuid().safeParse((await props.params).id);
  if (!id.success) notFound();
  const s = await getShipmentHeader(id.data).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <Link href="/shipments" className="rounded-sm text-sm text-muted-foreground hover:text-foreground" aria-label="Back to shipments">
          ←
        </Link>
        <h1 className="text-lg font-semibold">
          <Mono>{s.ref}</Mono>
        </h1>
        <ShipmentStatusBadge status={s.status} />
        <p className="text-sm text-muted-foreground">
          {s.supplier} <span aria-hidden>→</span>
          <span className="sr-only">to</span> {s.importer} <Mono className="text-xs">IEC {s.iec}</Mono>
        </p>
        <ShipmentNav shipmentId={s.id} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span>
            <Num value={String(s.unresolvedIssuesCount)} className="font-medium" /> <span className="text-muted-foreground">unresolved</span>
          </span>
          {s.failedCheckCount > 0 && (
            <StateBadge state="mismatch">
              <Num value={String(s.failedCheckCount)} /> {s.failedCheckCount === 1 ? "mismatch" : "mismatches"}
            </StateBadge>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{props.children}</div>
    </div>
  );
}
