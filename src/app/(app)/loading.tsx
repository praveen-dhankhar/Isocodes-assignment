import { Skeleton } from "@/components/ui/skeleton";

// Fallback for any signed-in screen without its own skeleton.
export default function Loading() {
  return (
    <main aria-busy className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-48" />
    </main>
  );
}
