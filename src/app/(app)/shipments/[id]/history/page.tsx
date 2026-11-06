import type { Metadata } from "next";
import { formatDateTime } from "@/components/shipments/format";
import { getShipmentHistory } from "@/server/queries/history";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "History · Customs cross-check" };

// S8: every event and every value change on the shipment, newest first.
export default async function HistoryPage(props: PageProps<"/shipments/[id]/history">) {
  await requireUser();
  const { id } = await props.params;
  const events = await getShipmentHistory(id);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h2 className="sr-only">History</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has happened on this shipment yet.</p>
      ) : (
        <ol className="relative flex flex-col border-l pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative py-2 text-sm">
              <span aria-hidden className="absolute top-3.5 -left-[1.4rem] size-2 rounded-full bg-border ring-2 ring-background" />
              <p>
                <time dateTime={e.at} className="mr-2 tabular-nums text-muted-foreground">
                  {formatDateTime(e.at)}
                </time>
                <span className="font-medium">{e.actor}</span> {e.text}
              </p>
              {e.detail && <p className="text-xs break-words text-muted-foreground tabular-nums">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
