import clsx from "clsx";
import { statusClass, statusLabel } from "../../lib/status";

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={clsx("badge", statusClass(status), className)}>
      {statusLabel(status)}
    </span>
  );
}
