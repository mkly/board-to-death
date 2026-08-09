import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PublishedEmbedLoading() {
  return (
    <main className="min-h-64 bg-background p-4 text-foreground sm:p-6" aria-label="Loading published agenda">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["search", "day", "room", "track"].map((filter) => (
              <Skeleton key={filter} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      </div>
    </main>
  );
}
