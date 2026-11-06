import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-busy className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <span className="sr-only">Loading the report…</span>
      <Skeleton className="h-6 w-64" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </main>
  );
}
