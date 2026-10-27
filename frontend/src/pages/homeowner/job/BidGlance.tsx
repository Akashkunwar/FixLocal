import { RatingStar } from "../../../components/ui/RatingStar";
import type { Bid, Job } from "../../../api/jobs";
import { money } from "../../../lib/format";
import {
  budgetFit,
  effectivePrice,
  type BidHighlight,
} from "../../../lib/bidCompare";
import { HighlightChips, ProAvatar } from "./BidCard";
import { t } from "../../../lib/i18n";

const dash = <span className="text-slate-300">—</span>;

function Rating({ b }: { b: Bid }) {
  const p = b.profile;
  if (!p || !p.reviewCount) return <span className="text-slate-500">{t("New")}</span>;
  return (
    <span>
      <span className="font-semibold text-slate-800">
        {p.averageRating.toFixed(1)}
        <RatingStar className="ml-0.5" />
      </span>{" "}
      <span className="text-slate-500">({p.reviewCount})</span>
    </span>
  );
}

function Price({ b, job }: { b: Bid; job: Job }) {
  const price = effectivePrice(b);
  const fit = budgetFit(price, job.budgetMin, job.budgetMax);
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-slate-900">{money(price)}</span>
      {fit?.kind === "over" && (
        <span className="ml-1 text-[11px] text-rose-700">{t("over budget")}</span>
      )}
    </span>
  );
}

/** One-screen comparison of the live bids. Table on wide screens, swipeable cards on phones. */
export function BidGlance({
  bids,
  highlights,
  job,
}: {
  bids: Bid[];
  highlights: Map<string, BidHighlight[]>;
  job: Job;
}) {
  if (bids.length < 2) return null;
  return (
    <div className="mt-4" data-testid="bid-glance">
      <h3 className="text-sm font-semibold text-slate-800">{t("At a glance")}</h3>

      {/* Phones: swipe through compact cards */}
      <ul
        className="-mx-4 mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:hidden"
        aria-label={t("Bids at a glance")}
      >
        {bids.map((b) => (
          <li
            key={b.id}
            className="w-[78%] shrink-0 snap-start rounded-xl bg-white p-3 ring-1 ring-slate-200"
          >
            <a
              href={`#bid-${b.id}`}
              className="block text-inherit no-underline"
            >
              <div className="flex items-center gap-2">
                <ProAvatar b={b} size={32} />
                <p className="truncate font-semibold text-slate-900">
                  {b.tradesperson?.name || t("Professional")}
                </p>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <HighlightChips tags={highlights.get(b.id) ?? []} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                <dt className="text-slate-500">{t("Price")}</dt>
                <dd className="text-right">
                  <Price b={b} job={job} />
                </dd>
                <dt className="text-slate-500">{t("Rating")}</dt>
                <dd className="text-right">
                  <Rating b={b} />
                </dd>
                <dt className="text-slate-500">{t("Jobs done")}</dt>
                <dd className="text-right">
                  {b.profile?.completedJobs ?? dash}
                </dd>
                <dt className="text-slate-500">{t("Done in")}</dt>
                <dd className="text-right">
                  {b.etaDays != null ? `${b.etaDays} d` : dash}
                </dd>
              </dl>
            </a>
          </li>
        ))}
      </ul>

      {/* Wider screens: a real comparison table */}
      <div className="mt-2 hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("Bids compared side by side")}</caption>
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Professional")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Price")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Rating")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Jobs done")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Done in")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("Distance")}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t("Details")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bids.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50/60">
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <div className="flex items-center gap-2">
                    <ProAvatar b={b} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {b.tradesperson?.name || t("Professional")}
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        <HighlightChips tags={highlights.get(b.id) ?? []} />
                      </div>
                    </div>
                  </div>
                </th>
                <td className="px-3 py-2.5">
                  <Price b={b} job={job} />
                </td>
                <td className="px-3 py-2.5">
                  <Rating b={b} />
                </td>
                <td className="px-3 py-2.5">
                  {b.profile?.completedJobs ?? dash}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {b.etaDays != null
                    ? `${b.etaDays} day${b.etaDays === 1 ? "" : "s"}`
                    : dash}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {b.distanceKm != null ? `~${b.distanceKm} km` : dash}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <a
                    href={`#bid-${b.id}`}
                    className="text-xs font-medium text-brand-700 no-underline hover:underline"
                  >
                    {t("View bid")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
