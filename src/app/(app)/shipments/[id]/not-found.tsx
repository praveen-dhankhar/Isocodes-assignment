import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ShipmentNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3 px-4 py-12">
      <h1 className="text-lg font-semibold">Shipment not found</h1>
      <p className="text-sm text-muted-foreground">The link may be mistyped, or the shipment no longer exists.</p>
      <Button variant="outline" asChild>
        <Link href="/shipments">All shipments</Link>
      </Button>
    </main>
  );
}
