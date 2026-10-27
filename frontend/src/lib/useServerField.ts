import { useState } from "react";

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Local form state that follows the server value only while the person hasn't edited it.
 * Saving one card on a page updates `user`; other cards' unsaved edits must survive that
 * (fe-logic HIGH 7). A field that still shows the old server value picks up the new one.
 */
export function useServerField<T>(server: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(server);
  const [seen, setSeen] = useState(server);
  if (!same(seen, server)) {
    setSeen(server);
    if (same(value, seen)) setValue(server);
  }
  return [value, setValue];
}
