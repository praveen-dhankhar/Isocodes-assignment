import { Num } from "@/components/ui/num";
import type { Rate } from "@/server/queries/accuracy";

const pct = (r: Rate) => (r.total === 0 ? null : (100 * (r.total - r.corrected)) / r.total);

/** Accuracy = 1 − corrected ÷ AI values (PRD §8.3), worst first. A neutral bar, not a colour: colour means state here. */
export function AccuracyTable({ caption, rows, keyLabel }: { caption: string; rows: Rate[]; keyLabel: string }) {
  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left font-medium">{caption}</caption>
      <thead className="text-left text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="py-1.5 pr-3 font-medium">{keyLabel}</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">AI values</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">Corrected</th>
          <th scope="col" className="w-2/5 py-1.5 font-medium">Accuracy</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const p = pct(r);
          return (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-1.5 pr-3">{r.label}</td>
              <td className="py-1.5 pr-3 text-right"><Num value={String(r.total)} /></td>
              <td className="py-1.5 pr-3 text-right"><Num value={String(r.corrected)} /></td>
              <td className="py-1.5">
                {p === null ? (
                  "—"
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${p}%` }} />
                    </span>
                    <span className="w-14 text-right">
                      <Num value={p.toFixed(1)} />%
                    </span>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
