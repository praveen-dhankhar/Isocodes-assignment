import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Workstation } from "@/components/review/workstation";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { AppError } from "@/lib/errors";
import { getReviewModel } from "@/server/queries/review-model";
import { markFirstOpened } from "@/server/services/shipments";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review · Customs cross-check" };

export default async function ReviewPage(props: PageProps<"/shipments/[id]">) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await props.params).id);
  if (!id.success) notFound();
  const model = await getReviewModel(id.data, user).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  await markFirstOpened(id.data);
  const { shipment } = model;

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <Link href="/shipments" className="rounded-sm text-sm text-muted-foreground hover:text-foreground" aria-label="Back to shipments">
          ←
        </Link>
        <h1 className="text-lg font-semibold">
          <Mono>{shipment.ref}</Mono>
        </h1>
        <ShipmentStatusBadge status={shipment.status} />
        <p className="text-sm text-muted-foreground">
          {shipment.supplier.name} <span aria-hidden>→</span>
          <span className="sr-only">to</span> {shipment.importer.name} <Mono className="text-xs">IEC {shipment.importer.iec}</Mono>
        </p>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span>
            <Num value={String(shipment.unresolvedIssuesCount)} className="font-medium" /> <span className="text-muted-foreground">unresolved</span>
          </span>
          {shipment.failedCheckCount > 0 && (
            <StateBadge state="mismatch">
              <Num value={String(shipment.failedCheckCount)} /> {shipment.failedCheckCount === 1 ? "mismatch" : "mismatches"}
            </StateBadge>
          )}
        </div>
      </header>
      <Workstation model={model} />
    </main>
  );
}
