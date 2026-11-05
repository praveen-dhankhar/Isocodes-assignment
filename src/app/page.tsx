import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";

// Temporary style check for the design tokens and tabular numbers. Replaced by the shipment list (S2).
const ROWS = [
  ["Gross weight, invoice (kg)", "3120.000"],
  ["Gross weight, packing list (kg)", "3165.000"],
  ["Quantity (PCS)", "2400"],
  ["Unit price (USD)", "6.80"],
  ["Invoice total (USD)", "16320.00"],
  ["Large total (INR)", "1234567.50"],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-12">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Style check</h1>
        <p className="text-sm text-muted-foreground">Temporary page: state badges, tabular numbers, monospaced codes.</p>
      </header>

      <section aria-label="State badges" className="flex flex-wrap gap-2">
        <StateBadge state="low" />
        <StateBadge state="mismatch" />
        <StateBadge state="ok" />
      </section>

      <table className="w-full text-sm">
        <tbody>
          {ROWS.map(([label, value]) => (
            <tr key={label} className="border-b last:border-0">
              <th scope="row" className="py-2 text-left font-normal text-muted-foreground">
                {label}
              </th>
              <td className="py-2 text-right">
                <Num value={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-sm text-muted-foreground">
        HSN <Mono className="text-foreground">94054290</Mono> · Container{" "}
        <Mono className="text-foreground">XZQU4821171</Mono>
      </p>
    </main>
  );
}
