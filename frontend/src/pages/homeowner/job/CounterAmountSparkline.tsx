/** Tiny inline chart of suggested counter amounts over time. */
export function CounterAmountSparkline({
  points,
}: {
  points: {
    t: number;
    amount: number;
    label: string;
    status: string;
    bidId: string;
  }[];
}) {
  const vals = points
    .map((p) => p.amount)
    .filter((a) => Number.isFinite(a) && a > 0);
  if (vals.length < 2) return null;
  const minA = Math.min(...vals);
  const maxA = Math.max(...vals);
  const span = Math.max(1, maxA - minA);
  const w = 320;
  const h = 48;
  const pad = 4;
  const step = (w - pad * 2) / Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p.amount - minA) / span) * (h - pad * 2);
    return { x, y, ...p };
  });
  const poly = coords.map((c) => `${c.x},${c.y}`).join(" ");
  return (
    <div className="mt-2">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-12 w-full max-w-md"
        role="img"
        aria-label="Counter amount sparkline"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className="text-violet-600"
          points={poly}
        />
        {coords.map((c, i) => (
          <circle
            key={`${c.bidId}-${c.t}-${i}`}
            cx={c.x}
            cy={c.y}
            r={2.5}
            className={
              c.status === "declined"
                ? "fill-rose-500"
                : c.status === "addressed"
                  ? "fill-emerald-600"
                  : "fill-violet-700"
            }
          >
            <title>
              {c.label}: ₹{Math.round(c.amount)} · {c.status}
            </title>
          </circle>
        ))}
      </svg>
      <p className="text-[10px] text-slate-400">
        ₹{Math.round(minA)} → ₹{Math.round(maxA)} · {points.length} counters
      </p>
    </div>
  );
}
