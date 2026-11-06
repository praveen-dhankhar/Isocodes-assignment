import type { Metadata } from "next";
import Link from "next/link";
import { NewShipmentForm } from "@/components/shipments/new-shipment-form";
import { SamplePicker } from "@/components/shipments/sample-picker";
import { listImporters, listSampleSets, listSuppliers } from "@/server/queries/shipments";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "New shipment · Customs cross-check" };

export default async function NewShipmentPage() {
  await requireUser();
  const [importers, suppliers] = await Promise.all([listImporters(), listSuppliers()]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <header className="space-y-1">
        <Link href="/shipments" className="rounded-sm text-sm text-muted-foreground hover:text-foreground">
          ← Shipments
        </Link>
        <h1 className="text-xl font-semibold text-balance">New shipment</h1>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          Upload the invoice, packing list and bill of lading. Each one is read as soon as it arrives; you review the values
          and the cross-checks on the next screen.
        </p>
      </header>

      <NewShipmentForm importers={importers} suppliers={suppliers} />

      <section id="samples" aria-labelledby="samples-heading" className="flex scroll-mt-20 flex-col gap-3">
        <div className="space-y-1">
          <h2 id="samples-heading" className="font-medium">
            Or load a sample set
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            Bundled synthetic documents, each showing one situation the cross-checks catch. Their extraction comes from
            recorded output and is labelled as such.
          </p>
        </div>
        <SamplePicker sets={listSampleSets()} />
      </section>
    </main>
  );
}
