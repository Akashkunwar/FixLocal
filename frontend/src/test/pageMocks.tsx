/** Light stand-ins for the app chrome so page tests render just the page. Import inside vi.mock. */
import type { ReactNode } from "react";

export function FakeShell({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  );
}
