import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useQuery } from "./useQuery";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useQuery", () => {
  it("ignores an older answer that arrives after a newer key's answer, and aborts it", async () => {
    const pending: Record<string, ReturnType<typeof deferred<string>>> = {};
    const signals: Record<string, AbortSignal> = {};
    let setKey!: (k: string) => void;
    function View() {
      const [key, sk] = useState("a");
      setKey = sk;
      const q = useQuery(key, (signal) => {
        signals[key] = signal;
        pending[key] = deferred<string>();
        return pending[key].promise;
      });
      return <p>{q.loading ? "loading" : q.data}</p>;
    }
    render(<View />);
    act(() => setKey("b"));
    expect(signals.a.aborted).toBe(true);
    await act(async () => pending.b.resolve("result b"));
    await act(async () => pending.a.resolve("result a"));
    expect(screen.getByText("result b")).toBeInTheDocument();
  });

  it("reports errors and recovers on reload", async () => {
    let fail = true;
    let reload!: () => Promise<void>;
    function View() {
      const q = useQuery("k", async () => {
        if (fail) throw new Error("boom");
        return "ok";
      });
      reload = q.reload;
      return <p>{q.error ? "error" : q.loading ? "loading" : q.data}</p>;
    }
    render(<View />);
    expect(await screen.findByText("error")).toBeInTheDocument();
    fail = false;
    await act(() => reload());
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
