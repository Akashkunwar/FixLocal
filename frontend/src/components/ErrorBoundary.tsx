import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null };

/** Keeps a rendering error on one page from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="card max-w-md space-y-3 p-6 text-center" role="alert">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this page</h1>
          <p className="text-sm text-slate-600">Reload to try again. If it keeps happening, let us know what you were doing.</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
