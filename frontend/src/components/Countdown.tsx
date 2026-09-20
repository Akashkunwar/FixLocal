import { useEffect, useState } from "react";

export function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * A self-updating "m:ss" countdown. It re-renders only itself each second,
 * so a long page showing it doesn't re-render as a whole.
 */
export function Countdown({ until }: { until: string | number }) {
  const end = typeof until === "number" ? until : new Date(until).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end <= Date.now()) return;
    const tmr = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= end) window.clearInterval(tmr);
    }, 1000);
    return () => window.clearInterval(tmr);
  }, [end]);
  return <span>{formatCountdown(end - now)}</span>;
}
