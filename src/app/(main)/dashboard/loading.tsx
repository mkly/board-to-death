import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardScreenLoading() {
  return (
    <div role="status" className="flex flex-col gap-6 p-4 md:p-6" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-2xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
