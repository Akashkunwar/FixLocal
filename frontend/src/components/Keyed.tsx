import { Fragment, type ReactNode } from "react";
import { useParams } from "react-router-dom";

/**
 * A page keyed by a route param: going from /jobs/a to /jobs/b mounts a fresh page instead of
 * reusing the old one with job A's state still in it (fe-logic HIGH 5).
 */
export function Keyed({ param, children }: { param: string; children: ReactNode }) {
  const params = useParams();
  return <Fragment key={params[param] ?? ""}>{children}</Fragment>;
}
