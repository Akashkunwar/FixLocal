import { Suspense, lazy, type ComponentProps } from "react";

import { t } from "../lib/i18n";
// Leaflet (~150 kB) is only needed once someone places a pin, so it lives in its own chunk.
const load = () => import("./MapPinPicker");
const MapPinPicker = lazy(() => load().then((m) => ({ default: m.MapPinPicker })));

/** Start downloading the map code in the background (e.g. while the user fills in step one). */
export function preloadMapPicker() {
  void load();
}

type Props = ComponentProps<typeof MapPinPicker>;

export function LazyMapPinPicker(props: Props) {
  const height = props.height ?? 260;
  return (
    <Suspense
      fallback={
        <div className={props.className}>
          <div
            className="flex items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-600 ring-1 ring-slate-200"
            style={{ height }}
            role="status"
          >
            
            {t("Loading map…")}
          </div>
        </div>
      }
    >
      <MapPinPicker {...props} />
    </Suspense>
  );
}
