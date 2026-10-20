// Visas direkt när man byter sida, medan servern hämtar data (streaming). Gör att navigeringen känns omedelbar.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Laddar" className="animate-pulse">
      <div className="mb-7 space-y-2">
        <div className="h-9 w-56 rounded-lg bg-fill" />
        <div className="h-4 w-80 max-w-full rounded-md bg-fill/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-[104px] p-5">
            <div className="h-3 w-24 rounded bg-fill" />
            <div className="mt-3 h-6 w-32 rounded bg-fill" />
          </div>
        ))}
      </div>
      <div className="card mt-6 space-y-4 p-5">
        <div className="h-4 w-40 rounded bg-fill" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-4 rounded bg-fill/70" style={{ width: `${92 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}
