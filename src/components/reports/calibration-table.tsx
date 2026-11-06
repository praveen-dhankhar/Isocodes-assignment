import { Num } from "@/components/ui/num";
import type { Rate } from "@/server/queries/accuracy";

/**
 * Is confidence honest? For each band of final confidence, how often people had to correct the value. A trustworthy
 * score shows a correction rate that falls as confidence rises; values below 0.85 always went through review (A-03).
 */
export function CalibrationTable({ rows }: { rows: Rate[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left font-medium">Confidence calibration</caption>
      <thead className="text-left text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="py-1.5 pr-3 font-medium">Final confidence</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">AI values</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">Corrected</th>
          <th scope="col" className="py-1.5 text-right font-medium">Correction rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-0">
            <td className="py-1.5 pr-3 tabular-nums">{r.label}</td>
            <td className="py-1.5 pr-3 text-right"><Num value={String(r.total)} /></td>
            <td className="py-1.5 pr-3 text-right"><Num value={String(r.corrected)} /></td>
            <td className="py-1.5 text-right">{r.total === 0 ? "—" : <><Num value={((100 * r.corrected) / r.total).toFixed(1)} />%</>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
