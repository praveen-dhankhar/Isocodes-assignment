import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The link may be mistyped, or the page has moved.</p>
      <Button variant="outline" asChild>
        <Link href="/shipments">Go to shipments</Link>
      </Button>
    </main>
  );
}
