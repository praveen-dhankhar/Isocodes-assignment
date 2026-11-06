import type { Metadata } from "next";
import Link from "next/link";
import { AccuracyTable } from "@/components/reports/accuracy-table";
import { CalibrationTable } from "@/components/reports/calibration-table";
import { formatDateTime } from "@/components/shipments/format";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { getAccuracyReport } from "@/server/queries/accuracy";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Accuracy · Customs cross-check" };
const ACTION = { CONFIRM: "Confirmed", CORRECT: "Corrected", MANUAL_ENTRY: "Entered" } as const;

// S7 (manager). PRD §2 metrics and §8.3: what counts against the AI is a correction of a value it read.
export default async function AccuracyPage(props: PageProps<"/reports/accuracy">) {
  const user = await requireUser();
  if (user.role !== "DOCUMENTATION_MANAGER") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <h1 className="text-lg font-semibold">Accuracy report</h1>
        <p className="mt-2 text-sm text-muted-foreground">This report is for documentation managers.</p>
      </main>
    );
  }
  const includeSamples = (await props.searchParams).samples === "1";
  const r = await getAccuracyReport({ includeSamples });
  const overall = r.overall.total === 0 ? null : (100 * (r.overall.total - r.overall.corrected)) / r.overall.total;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Accuracy and edit history</h1>
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            Approved and exported shipments. A value counts as an AI error only when someone corrected what the AI read; confirmations, values
            entered by hand and accepted discrepancies do not.
          </p>
        </div>
        <nav aria-label="Extraction mode" className="flex rounded-lg bg-muted p-0.5 text-sm">
          <Link href="/reports/accuracy" aria-current={!includeSamples ? "page" : undefined} className={`rounded-md px-2.5 py-1 ${!includeSamples ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Live only</Link>
          <Link href="/reports/accuracy?samples=1" aria-current={includeSamples ? "page" : undefined} className={`rounded-md px-2.5 py-1 ${includeSamples ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Include recorded samples</Link>
        </nav>
      </header>

      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Field accuracy</dt><dd className="text-lg font-medium">{overall === null ? "—" : <><Num value={overall.toFixed(1)} />%</>} <span className="text-sm font-normal text-muted-foreground">of <Num value={String(r.overall.total)} /> AI values</span></dd></div>
        <div><dt className="text-muted-foreground">Median review time (A-22)</dt><dd className="text-lg font-medium">{r.reviewMinutes.median === null ? "—" : <><Num value={r.reviewMinutes.median.toFixed(1)} /> min</>} <span className="text-sm font-normal text-muted-foreground">over <Num value={String(r.reviewMinutes.shipments)} /> shipment(s)</span></dd></div>
        <div><dt className="text-muted-foreground">Caught before export (proxy for amendments)</dt><dd className="text-lg font-medium"><Num value={String(r.caught.accepted + r.overall.corrected)} /> <span className="text-sm font-normal text-muted-foreground">(<Num value={String(r.overall.corrected)} /> misreads corrected, <Num value={String(r.caught.accepted)} /> discrepancies declared)</span></dd></div>
      </dl>

      {r.overall.total === 0 ? (
        <section className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6 text-sm">
          <h2 className="font-medium">No {includeSamples ? "" : "live "}extractions approved yet</h2>
          <p className="text-muted-foreground">
            Accuracy is measured on shipments a manager has approved.{" "}
            {!includeSamples && <>The seeded demo data was read from recorded samples; <Link className="underline underline-offset-4" href="/reports/accuracy?samples=1">include them</Link> to see it.</>}
          </p>
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <AccuracyTable caption="By field" keyLabel="Field" rows={r.byField} />
          <div className="flex flex-col gap-8">
            <AccuracyTable caption="By supplier" keyLabel="Supplier" rows={r.bySupplier} />
            <CalibrationTable rows={r.calibration} />
          </div>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Edit log</h2>
        {r.log.length === 0 ? (
          <p className="text-sm text-muted-foreground">No edits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  {["When", "Shipment", "Field", "What", "AI read", "Now", "By"].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.log.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(e.at)}</td>
                    <td className="py-1.5 pr-3"><Link className="underline-offset-4 hover:underline" href={`/shipments/${e.shipmentId}/history`}><Mono className="whitespace-nowrap">{e.ref}</Mono></Link></td>
                    <td className="py-1.5 pr-3">{e.where}</td>
                    <td className="py-1.5 pr-3">{ACTION[e.action]}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{e.ai || "nothing"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.to}</td>
                    <td className="py-1.5 whitespace-nowrap">{e.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
