import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  acceptBid,
  bidEscrowAmount,
  escrowWhatIf,
  cancelJob,
  confirmJobComplete,
  setPhotoConsent,
  getJob,
  listBids,
  getShortlistRanked,
  getPublicProfile,
  getSuggestedPros,
  inviteSuggestedPro,
  bulkInviteSuggestedPros,
  listJobInvites,
  getJobInviteAnalytics,
  getShortlistInviteAnalytics,
  requestQuoteRevise,
  markQuoteViewed,
  getCounterAnalytics,
  type Bid,
  type Job,
  type JobInvite,
  type InviteAnalytics,
  type ShortlistInviteAnalytics,
  type SuggestedPro,
  type CounterAnalytics,
  type EscrowWhatIf,
} from "../../../api/jobs";
import {
  getJobReview,
  addFavorite,
  removeFavorite,
  listFavorites,
  type JobReview,
} from "../../../api/extras";
import { ApiError, isAbort } from "../../../api/client";
import { useToast } from "../../../components/Toast";
import { useAuth } from "../../../auth/AuthContext";
import { mergeInviteTemplates } from "../../../lib/inviteTemplates";
import {
  normalizeWeeklyAvailability,
  type WeeklyAvailability,
} from "../../../lib/availability";
import {
  previewEscrowSplit,
  escrowHoldAmount,
} from "../../../lib/escrowWhatIf";
import {
  DEFAULT_HOMEOWNER_COUNTER_NOTES,
  mergeHomeownerCounterNotes,
  type HomeownerCounterNoteTemplate,
} from "../../../lib/homeownerCounterNotes";
import { type BestValueExplainRow } from "../../../components/BestValueExplainPanel";

/** All state, data loading and actions for the client job page. */
export function useJobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();
  const { success, error } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDispute, setShowDispute] = useState(false);
  const [review, setReview] = useState<JobReview | null>(null);
  const [proReview, setProReview] = useState<JobReview | null>(null);
  const [saved, setSaved] = useState(false);
  const [proAvailability, setProAvailability] =
    useState<WeeklyAvailability | null>(null);
  const [proBlockedDates, setProBlockedDates] = useState<string[]>([]);
  const [suggestedPros, setSuggestedPros] = useState<SuggestedPro[]>([]);
  const [invitingProId, setInvitingProId] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [inviteHistory, setInviteHistory] = useState<JobInvite[]>([]);
  const [inviteQuota, setInviteQuota] = useState<{
    used: number;
    limit: number;
    remaining: number;
  } | null>(null);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [inviteAnalytics, setInviteAnalytics] =
    useState<InviteAnalytics | null>(null);
  const [shortlistFunnel, setShortlistFunnel] =
    useState<ShortlistInviteAnalytics | null>(null);
  const [inviteSource, setInviteSource] = useState<
    "shortlist" | "suggested" | "profile"
  >("suggested");
  const [inviteRank, setInviteRank] = useState<number | null>(null);
  const [inviteSmartScore, setInviteSmartScore] = useState<number | null>(null);
  const [scorePro, setScorePro] = useState<SuggestedPro | null>(null);
  const [shortlistPros, setShortlistPros] = useState<
    {
      userId: string;
      name?: string | null;
      skills?: string | null;
      averageRating?: number;
      reviewCount?: number;
      verificationStatus?: string;
      notes?: string | null;
      tags?: string[];
      tagHits?: string[];
      tagBoost?: number;
      score?: number;
      smartScore?: number;
      responseSla?: SuggestedPro["responseSla"];
      availabilityHeat?: {
        score: number;
        totalHours: number;
        clean: boolean;
      } | null;
      inviteBlockedByHeat?: boolean;
      inviteHeatReason?: string | null;
      shortlistInviteMinHeat?: number;
    }[]
  >([]);
  const [shortlistMinHeat, setShortlistMinHeat] = useState(25);
  const [shortlistSelected, setShortlistSelected] = useState<string[]>([]);
  const [shortlistBulkOpen, setShortlistBulkOpen] = useState(false);
  const [shortlistBulkMsg, setShortlistBulkMsg] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteTemplates = useMemo(
    () => mergeInviteTemplates(user?.inviteTemplates),
    [user?.inviteTemplates],
  );
  const [tplLabel, setTplLabel] = useState("");
  const [highlightBidId, setHighlightBidId] = useState<string | null>(null);
  const [counterBidId, setCounterBidId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNotes, setCounterNotes] = useState("");
  const [hoNoteTemplates, setHoNoteTemplates] = useState<
    HomeownerCounterNoteTemplate[]
  >(DEFAULT_HOMEOWNER_COUNTER_NOTES);
  const [bestValueWeights, setBestValueWeights] = useState({
    matchPct: 55,
    pricePct: 45,
    slaHeatPct: 0,
  });
  const [bestValueExplain, setBestValueExplain] =
    useState<BestValueExplainRow | null>(null);
  const [counterBusy, setCounterBusy] = useState(false);
  const [counterAnalytics, setCounterAnalytics] =
    useState<CounterAnalytics | null>(null);
  const [whatIfByBid, setWhatIfByBid] = useState<
    Record<string, EscrowWhatIf | null>
  >({});
  const [whatIfCustom, setWhatIfCustom] = useState<Record<string, string>>({});
  const quoteViewedSent = useRef(new Set<string>());

  const loadSeq = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);

  /** Loads everything for the page; a newer call (or leaving the page) cancels older ones. */
  async function load() {
    if (!id) return;
    loadAbort.current?.abort();
    const ctrl = new AbortController();
    loadAbort.current = ctrl;
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current && !ctrl.signal.aborted;
    const soft = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
    if (!job || job.id !== id) setLoading(true);
    try {
      const [j, b, r] = await Promise.all([
        getJob(id, ctrl.signal),
        listBids(id, ctrl.signal),
        soft(getJobReview(id, ctrl.signal)),
      ]);
      if (!current()) return;
      setJob(j.job);
      setBids(b.bids);
      if (
        b.bestValueBlend?.matchPct != null &&
        b.bestValueBlend?.pricePct != null
      ) {
        setBestValueWeights({
          matchPct: Number(b.bestValueBlend.matchPct),
          pricePct: Number(b.bestValueBlend.pricePct),
          slaHeatPct: Number(b.bestValueBlend.slaHeatPct ?? 0),
        });
      }
      setHoNoteTemplates(
        mergeHomeownerCounterNotes(user?.homeownerCounterTemplates),
      );
      setReview(r?.review ?? null);
      setProReview(r?.proReview ?? null);

      const accepted = b.bids.find((x) => x.id === j.job.acceptedBidId);
      const isOpen = j.job.status === "open";
      const [pub, suggested, inv, inviteStats, counters, ranked] =
        await Promise.all([
          accepted?.tradespersonId
            ? soft(getPublicProfile(accepted.tradespersonId))
            : Promise.resolve(null),
          isOpen ? soft(getSuggestedPros(id, 5)) : Promise.resolve(null),
          soft(listJobInvites(id)),
          soft(getJobInviteAnalytics(id)),
          soft(getCounterAnalytics({ jobId: id })),
          soft(getShortlistRanked(id)),
        ]);
      if (!current()) return;
      setProAvailability(
        pub?.profile.weeklyAvailability
          ? normalizeWeeklyAvailability(pub.profile.weeklyAvailability)
          : null,
      );
      setProBlockedDates(pub?.profile.blockedDates || []);
      setSuggestedPros(suggested?.suggestions || []);
      setInviteHistory(inv?.invites || []);
      setInviteQuota(
        inv
          ? { used: inv.used, limit: inv.limit, remaining: inv.remaining }
          : null,
      );
      if (inv) {
        const pendingIds = inv.invites
          .filter((x) => x.status === "pending")
          .map((x) => x.tradespersonId);
        setInvitedIds((prev) => [...new Set([...prev, ...pendingIds])]);
      }
      setInviteAnalytics(inviteStats);
      setCounterAnalytics(counters);

      if (ranked) {
        if (ranked.shortlistInviteMinHeat != null)
          setShortlistMinHeat(Number(ranked.shortlistInviteMinHeat) || 25);
        setShortlistPros(
          (ranked.shortlist || []).map((p) => ({
            userId: p.userId,
            name: p.name,
            skills: p.skills,
            averageRating: Number(p.averageRating || 0),
            reviewCount: p.reviewCount || 0,
            verificationStatus: p.verificationStatus || undefined,
            notes: p.notes || null,
            tags: p.tags || [],
            tagHits: p.tagHits || [],
            tagBoost: p.tagBoost || 0,
            score: p.score,
            smartScore: p.smartScore,
            responseSla: p.responseSla || null,
            availabilityHeat: p.availabilityHeat || null,
            inviteBlockedByHeat: Boolean(p.inviteBlockedByHeat),
            inviteHeatReason: p.inviteHeatReason || null,
            shortlistInviteMinHeat: p.shortlistInviteMinHeat,
          })),
        );
      } else {
        const fav = await soft(listFavorites("pro"));
        if (!current()) return;
        setShortlistPros(
          (fav?.favorites || [])
            .filter((f) => f.targetType === "pro" && f.pro)
            .map((f) => ({
              userId: f.targetId,
              name: f.pro?.name,
              skills: f.pro?.skills,
              averageRating: Number(f.pro?.averageRating || 0),
              reviewCount: f.pro?.reviewCount || 0,
              verificationStatus: f.pro?.verificationStatus,
              notes: f.notes || null,
              tags: f.tags || [],
              responseSla:
                (f.pro?.responseSla as SuggestedPro["responseSla"]) || null,
            })),
        );
      }
    } catch (e) {
      if (isAbort(e) || !current()) return;
      error((e as Error).message || "Failed to load job");
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => loadAbort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Deep-link from Favorites: ?shortlistInvite=id1,id2
  useEffect(() => {
    const raw = searchParams.get("shortlistInvite");
    if (!raw || !shortlistPros.length) return;
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = ids.filter((id) =>
      shortlistPros.some((p) => p.userId === id),
    );
    if (valid.length) {
      setShortlistSelected(valid);
      setShortlistBulkOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("shortlistInvite");
      setSearchParams(next, { replace: true });
    }
  }, [shortlistPros, searchParams, setSearchParams]);

  // Wave 17: deep-link quote-Δ notify → highlight bid card
  useEffect(() => {
    const bidParam = searchParams.get("bid");
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const fromHash = hash.startsWith("#bid-") ? hash.slice(5) : null;
    const target = bidParam || fromHash;
    if (!target || !bids.length) return;
    if (!bids.some((b) => b.id === target)) return;
    setHighlightBidId(target);
    const t = window.setTimeout(() => {
      const el = document.getElementById(`bid-${target}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    // Soft clear highlight after a few seconds; keep URL for shareability
    const clear = window.setTimeout(
      () => setHighlightBidId((cur) => (cur === target ? null : cur)),
      6000,
    );
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clear);
    };
  }, [bids, searchParams]);

  // Wave 17: soft pro alert when homeowner views a revised quote
  useEffect(() => {
    if (!job || job.status !== "open") return;
    const revised = bids.filter(
      (b) =>
        b.status === "active" &&
        Array.isArray(b.quoteHistory) &&
        b.quoteHistory.length > 0,
    );
    for (const b of revised) {
      if (quoteViewedSent.current.has(b.id)) continue;
      quoteViewedSent.current.add(b.id);
      markQuoteViewed(b.id).catch(() => {
        quoteViewedSent.current.delete(b.id);
      });
    }
  }, [job, bids]);

  // Re-render the page only when a cooldown ends; the visible countdowns tick on their own.
  useEffect(() => {
    const now = Date.now();
    const next = inviteHistory
      .map((i) =>
        i.inCooldown && i.cooldownUntil
          ? new Date(i.cooldownUntil).getTime()
          : 0,
      )
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const tmr = window.setTimeout(
      () => setNowTick(Date.now()),
      next - now + 50,
    );
    return () => window.clearTimeout(tmr);
  }, [inviteHistory, nowTick]);

  const cooldownByPro = useMemo(() => {
    const map = new Map<string, JobInvite>();
    for (const inv of inviteHistory) {
      if (!inv.inCooldown || !inv.cooldownUntil) continue;
      const until = new Date(inv.cooldownUntil).getTime();
      if (until <= nowTick) continue;
      const prev = map.get(inv.tradespersonId);
      if (!prev || new Date(prev.cooldownUntil || 0).getTime() < until) {
        map.set(inv.tradespersonId, inv);
      }
    }
    return map;
  }, [inviteHistory, nowTick]);

  function toggleSelectPro(userId: string) {
    setSelectedInviteIds((prev) =>
      prev.includes(userId)
        ? prev.filter((x) => x !== userId)
        : [...prev, userId],
    );
  }

  async function onInvitePro(
    pro: SuggestedPro,
    opts?: {
      source?: "shortlist" | "suggested" | "profile";
      shortlistRank?: number;
      smartScore?: number;
    },
  ) {
    if (!id || !job) return;
    setInvitingProId(pro.userId);
    setInviteSource(opts?.source || "suggested");
    setInviteRank(opts?.shortlistRank ?? null);
    setInviteSmartScore(opts?.smartScore ?? null);
  }

  async function refreshInvites() {
    if (!id) return;
    try {
      const inv = await listJobInvites(id);
      setInviteHistory(inv.invites || []);
      setInviteQuota({
        used: inv.used,
        limit: inv.limit,
        remaining: inv.remaining,
      });
      const pendingIds = (inv.invites || [])
        .filter((x) => x.status === "pending")
        .map((x) => x.tradespersonId);
      setInvitedIds((prev) => [...new Set([...prev, ...pendingIds])]);
      try {
        setInviteAnalytics(await getJobInviteAnalytics(id));
      } catch {
        /* ignore */
      }
      try {
        setShortlistFunnel(await getShortlistInviteAnalytics(id));
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  async function confirmInvite() {
    if (!id || !invitingProId) return;
    setInviteBusy(true);
    try {
      const r = await inviteSuggestedPro(id, {
        tradespersonId: invitingProId,
        message: inviteMessage.trim() || undefined,
        source: inviteSource,
        shortlistRank: inviteRank ?? undefined,
        smartScore: inviteSmartScore ?? undefined,
        minHeat: inviteSource === "shortlist" ? shortlistMinHeat : undefined,
      });
      success(r.message || "Invite sent");
      setInvitedIds((prev) =>
        prev.includes(invitingProId) ? prev : [...prev, invitingProId],
      );
      setInvitingProId(null);
      setInviteMessage("");
      setInviteSource("suggested");
      setInviteRank(null);
      setInviteSmartScore(null);
      await refreshInvites();
    } catch (caught) {
      const e = caught as ApiError;
      if (e?.code === "ALREADY_INVITED") {
        setInvitedIds((prev) =>
          invitingProId && !prev.includes(invitingProId)
            ? [...prev, invitingProId]
            : prev,
        );
        setInvitingProId(null);
        setInviteMessage("");
        error(e.message || "Already invited");
        await refreshInvites();
      } else if (e?.code === "INVITE_COOLDOWN") {
        error(e.message || "Invite cooldown");
        await refreshInvites();
      } else if (e?.code === "SHORTLIST_HEAT_TOO_LOW") {
        error(
          e.message || "Pro availability heat too low for shortlist invite",
        );
      } else {
        error(e.message || "Invite failed");
      }
    } finally {
      setInviteBusy(false);
    }
  }

  async function confirmBulkInvite() {
    if (!id || selectedInviteIds.length === 0) return;
    setInviteBusy(true);
    try {
      const r = await bulkInviteSuggestedPros(id, {
        tradespersonIds: selectedInviteIds,
        message: bulkMessage.trim() || undefined,
      });
      success(r.message || `Sent ${r.sent} invite(s)`);
      const okIds = r.results.filter((x) => x.ok).map((x) => x.tradespersonId);
      setInvitedIds((prev) => [...new Set([...prev, ...okIds])]);
      setSelectedInviteIds([]);
      setBulkConfirmOpen(false);
      setBulkMode(false);
      setBulkMessage("");
      await refreshInvites();
      if (r.stoppedForRateLimit) {
        error("Invite limit reached mid-batch — remaining pros were skipped");
      }
    } catch (e) {
      error((e as Error).message || "Bulk invite failed");
    } finally {
      setInviteBusy(false);
    }
  }

  async function confirmShortlistBulkInvite() {
    if (!id || shortlistSelected.length === 0) return;
    const eligible = shortlistSelected.filter((uid) => {
      const p = shortlistPros.find((x) => x.userId === uid);
      return !p?.inviteBlockedByHeat;
    });
    const blocked = shortlistSelected.length - eligible.length;
    if (!eligible.length) {
      error(
        `All selected pros are below heat ≥${shortlistMinHeat} (clean schedules only)`,
      );
      return;
    }
    setInviteBusy(true);
    try {
      const ranks: Record<string, number> = {};
      const scores: Record<string, number> = {};
      eligible.forEach((uid) => {
        const idx = shortlistPros.findIndex((p) => p.userId === uid);
        if (idx >= 0) {
          ranks[uid] = idx + 1;
          if (shortlistPros[idx].smartScore != null) {
            scores[uid] = Number(shortlistPros[idx].smartScore);
          }
        }
      });
      const r = await bulkInviteSuggestedPros(id, {
        tradespersonIds: eligible,
        message: shortlistBulkMsg.trim() || undefined,
        source: "shortlist",
        shortlistRanks: ranks,
        smartScores: scores,
        minHeat: shortlistMinHeat,
      });
      if (blocked > 0) {
        error(`Skipped ${blocked} pro(s) below heat ≥${shortlistMinHeat}`);
      }
      success(r.message || `Sent ${r.sent} shortlist invite(s)`);
      const okIds = r.results.filter((x) => x.ok).map((x) => x.tradespersonId);
      setInvitedIds((prev) => [...new Set([...prev, ...okIds])]);
      setShortlistSelected([]);
      setShortlistBulkOpen(false);
      setShortlistBulkMsg("");
      await refreshInvites();
      if (r.stoppedForRateLimit) {
        error("Invite limit reached mid-batch — remaining pros were skipped");
      }
    } catch (e) {
      error((e as Error).message || "Shortlist bulk invite failed");
    } finally {
      setInviteBusy(false);
    }
  }

  const competingBids = useMemo(() => {
    return bids.filter((b) => b.status === "active");
  }, [bids]);

  const sideBySideWhatIf = useMemo(() => {
    if (competingBids.length < 2) return null;
    const rows = competingBids.map((b) => {
      const custom = whatIfCustom[b.id];
      const customN = custom != null && custom !== "" ? Number(custom) : NaN;
      const hold =
        Number.isFinite(customN) && customN > 0 ? customN : escrowHoldAmount(b);
      const split = previewEscrowSplit(hold);
      const name = b.tradesperson?.name || "Pro";
      return {
        bid: b,
        hold,
        split,
        name,
        source: Number(b.quoteAmount) > 0 ? "quote" : "bid",
      };
    });
    // Clean = all have positive hold and 3 milestones
    if (!rows.every((r) => r.hold > 0 && r.split.milestones.length === 3))
      return null;
    return rows;
  }, [competingBids, whatIfCustom]);

  /** Wave 21–23: best-value blend = match + lower escrow (+ optional SLA/heat). */
  const bestValueBlend = useMemo(() => {
    const slaTierPoints = (tier?: string | null) => {
      if (tier === "lightning") return 20;
      if (tier === "fast") return 15;
      if (tier === "same_day") return 10;
      if (tier === "steady") return 5;
      if (tier === "slow") return 0;
      return 5; // unknown / missing — soft middle
    };
    const active = competingBids.filter((b) => {
      const hold = escrowHoldAmount(b);
      const score = Number(b.rankedScore ?? b.matchScore);
      return hold > 0 && Number.isFinite(score);
    });
    if (active.length < 2) return null;
    const scores = active.map((b) => Number(b.rankedScore ?? b.matchScore));
    const holds = active.map((b) => escrowHoldAmount(b));
    const slaHeats = active.map(
      (b) => Number(b.heatBoost || 0) + slaTierPoints(b.responseSla?.tier),
    );
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const minHold = Math.min(...holds);
    const maxHold = Math.max(...holds);
    const minSla = Math.min(...slaHeats);
    const maxSla = Math.max(...slaHeats);
    const scoreSpan = Math.max(1, maxScore - minScore);
    const holdSpan = Math.max(1, maxHold - minHold);
    const slaSpan = Math.max(1, maxSla - minSla);
    let matchW = Number(bestValueWeights.matchPct);
    let priceW = Number(bestValueWeights.pricePct);
    let slaW = Number(bestValueWeights.slaHeatPct ?? 0);
    if (!Number.isFinite(matchW) || matchW < 0) matchW = 55;
    if (!Number.isFinite(priceW) || priceW < 0) priceW = 45;
    if (!Number.isFinite(slaW) || slaW < 0) slaW = 0;
    const wSum = matchW + priceW + slaW || 100;
    matchW = matchW / wSum;
    priceW = priceW / wSum;
    slaW = slaW / wSum;
    const matchPct = Math.round(matchW * 1000) / 10;
    const pricePct = Math.round(priceW * 1000) / 10;
    const slaHeatPct = Math.round(slaW * 1000) / 10;
    const rows = active.map((b) => {
      const score = Number(b.rankedScore ?? b.matchScore);
      const hold = escrowHoldAmount(b);
      const slaHeatRaw =
        Number(b.heatBoost || 0) + slaTierPoints(b.responseSla?.tier);
      const matchNorm = (score - minScore) / scoreSpan;
      const priceNorm = (maxHold - hold) / holdSpan;
      const slaHeatNorm = (slaHeatRaw - minSla) / slaSpan;
      const valueScore =
        Math.round(
          (matchW * matchNorm + priceW * priceNorm + slaW * slaHeatNorm) * 1000,
        ) / 10;
      return {
        bidId: b.id,
        name: b.tradesperson?.name || "Pro",
        matchScore: score,
        hold,
        matchNorm,
        priceNorm,
        slaHeatNorm,
        slaHeatRaw,
        valueScore,
        matchPct,
        pricePct,
        slaHeatPct,
      };
    });
    rows.sort((a, b) => b.valueScore - a.valueScore);
    return {
      rows,
      bestBidId: rows[0]?.bidId || null,
      matchPct,
      pricePct,
      slaHeatPct,
      clean: rows.length >= 2 && rows.every((r) => r.hold > 0),
    };
  }, [competingBids, bestValueWeights]);

  /** Wave 22: soft counter amount hint from peer best-value bids when clean. */
  const peerBestValueCounterHint = useMemo(() => {
    if (!bestValueBlend?.clean || !bestValueBlend.rows.length) return null;
    const peers = bestValueBlend.rows.filter((r) => r.bidId !== counterBidId);
    if (!peers.length) return null;
    // Prefer the current best-value peer hold; else average of top peers
    const best =
      peers.find((r) => r.bidId === bestValueBlend.bestBidId) || peers[0];
    const avgHold = Math.round(
      peers.slice(0, 3).reduce((s, r) => s + r.hold, 0) /
        Math.min(3, peers.length),
    );
    const suggested = Math.max(1, Math.round(best.hold));
    return {
      suggested,
      avgHold,
      peerName: best.name,
      isBestPeer: best.bidId === bestValueBlend.bestBidId,
    };
  }, [bestValueBlend, counterBidId]);

  /** Wave 21: counter negotiation timeline points across this job's bids. */
  const counterNegotiationSpark = useMemo(() => {
    const points: {
      t: number;
      amount: number;
      label: string;
      status: string;
      bidId: string;
    }[] = [];
    for (const b of bids) {
      const hist = Array.isArray(b.counterHistory) ? b.counterHistory : [];
      for (const h of hist) {
        const t = new Date(h.requestedAt).getTime();
        if (!Number.isFinite(t)) continue;
        points.push({
          t,
          amount: Number(h.suggestedAmount) || 0,
          label: b.tradesperson?.name || "Pro",
          status: h.status,
          bidId: b.id,
        });
      }
      if (b.counterOffer) {
        const t = new Date(b.counterOffer.requestedAt).getTime();
        if (Number.isFinite(t)) {
          // Avoid dup if still pending and already in history oddly
          const dup = points.some(
            (p) =>
              p.bidId === b.id &&
              Math.abs(p.t - t) < 1000 &&
              Math.abs(p.amount - Number(b.counterOffer!.suggestedAmount)) <
                0.5,
          );
          if (!dup) {
            points.push({
              t,
              amount: Number(b.counterOffer.suggestedAmount) || 0,
              label: b.tradesperson?.name || "Pro",
              status: b.counterOffer.status,
              bidId: b.id,
            });
          }
        }
      }
    }
    points.sort((a, b) => a.t - b.t);
    if (points.length < 2) return null;
    return points.slice(-12);
  }, [bids]);

  useEffect(() => {
    let cancelled = false;
    async function softFetchWhatIfs() {
      const active = bids.filter(
        (b) => b.status === "active" || b.status === "accepted",
      );
      if (!active.length) {
        if (!cancelled) setWhatIfByBid({});
        return;
      }
      const entries = await Promise.all(
        active.map(async (b) => {
          try {
            const hold = escrowHoldAmount(b);
            const w = await escrowWhatIf(b.id, hold > 0 ? hold : undefined);
            return [b.id, w] as const;
          } catch {
            return [b.id, null] as const;
          }
        }),
      );
      if (!cancelled) {
        setWhatIfByBid(Object.fromEntries(entries));
      }
    }
    softFetchWhatIfs();
    return () => {
      cancelled = true;
    };
  }, [bids]);

  async function onCounterOffer(bidId: string) {
    const amt = Number(counterAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      error("Enter a valid suggested amount");
      return;
    }
    setCounterBusy(true);
    try {
      await requestQuoteRevise(bidId, {
        suggestedAmount: amt,
        notes: counterNotes.trim() || undefined,
      });
      success("Counter-offer / revise request sent to the pro");
      setCounterBidId(null);
      setCounterAmount("");
      setCounterNotes("");
      await load();
    } catch (e) {
      error((e as Error).message || "Could not send counter-offer");
    } finally {
      setCounterBusy(false);
    }
  }

  async function onAccept(bidId: string) {
    const bid = bids.find((b) => b.id === bidId);
    if (!bid) return;
    const hasQuote = bid.quoteAmount != null && Number(bid.quoteAmount) > 0;
    const escrowPreview = bidEscrowAmount(bid);
    const counter = bid?.counterOffer;
    const counterAddressed = counter?.status === "addressed";
    const counterSuggested =
      counter && Number.isFinite(Number(counter.suggestedAmount))
        ? Number(counter.suggestedAmount)
        : null;
    const differs =
      counterAddressed &&
      counterSuggested != null &&
      Math.abs(escrowPreview - counterSuggested) >= 1;

    let whatIfNote = "";
    try {
      const w = await escrowWhatIf(bidId, escrowPreview);
      const lines = (w.milestones || [])
        .map(
          (m) =>
            `  ${m.sequence}. ${m.label} (${m.percent}%) · ₹${Number(m.amount).toFixed(0)}`,
        )
        .join("\n");
      whatIfNote =
        `\n\nEscrow what-if (simulated milestone split):\n` +
        (lines || "  (no milestones)") +
        `\nTotal hold ₹${Number(w.amount).toFixed(0)}`;
    } catch {
      /* soft — confirm still works without what-if */
    }

    let msg = hasQuote
      ? `Accept this bid and hold ₹${escrowPreview.toFixed(0)} in simulated escrow from the structured quote? (Payments are simulated — no real charge.)`
      : `Accept this bid and hold ₹${escrowPreview.toFixed(0)} in simulated escrow from the bid amount? (Payments are simulated — no real charge.)`;
    if (differs) {
      const delta = Math.round(escrowPreview - counterSuggested!);
      const sign = delta > 0 ? "+" : "";
      msg =
        `Soft escrow hold preview:\n` +
        `• Counter suggested ₹${counterSuggested!.toFixed(0)}\n` +
        `• Final ${hasQuote ? "quote" : "bid"} ₹${escrowPreview.toFixed(0)} (${sign}₹${Math.abs(delta)})\n` +
        `Simulated escrow will hold ₹${escrowPreview.toFixed(0)}. Continue? (No real charge.)`;
    }
    msg += whatIfNote;
    const ok = confirm(msg);
    if (!ok) return;
    try {
      const r = await acceptBid(bid);
      const src = r.escrow?.source === "quote" ? "quote" : "bid";
      const amt = r.escrow?.amount ?? escrowPreview;
      const previewNote = r.escrow?.softHoldPreview?.note;
      success(
        previewNote
          ? `Accepted · ₹${Number(amt).toFixed(0)} held (${src}) — ${previewNote}`
          : src === "quote"
            ? `Accepted · ₹${Number(amt).toFixed(0)} held from quote (simulated escrow)`
            : `Accepted · ₹${Number(amt).toFixed(0)} held from bid (simulated escrow)`,
      );
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED") {
        const now = Number(e.details?.currentAmount);
        error(
          `The professional changed their quote${Number.isFinite(now) ? ` to ₹${now.toFixed(0)}` : ""}. Review the new amount and accept again.`,
        );
        setHighlightBidId(bidId);
        load();
        return;
      }
      error((e as Error).message);
    }
  }

  async function onComplete() {
    const pending = job?.status === "pending_confirmation";
    const ok = confirm(
      pending
        ? "Confirm the work is complete? Any payment still held will be released to the professional."
        : "Mark this job complete now? Any payment still held will be released to the professional, even though they haven't marked the work done.",
    );
    if (!ok) return;
    try {
      const r = await confirmJobComplete(id!);
      if (r.autoReleased && r.autoReleased.count > 0) {
        success(
          `Job completed — ${r.autoReleased.count} remaining payment milestone(s) released`,
        );
      } else {
        success("Job marked completed");
      }
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function onPhotoConsent(consent: boolean) {
    try {
      const r = await setPhotoConsent(id!, consent);
      setJob(r.job);
      success(
        consent
          ? "The professional may publish photos from this job"
          : "Photo publishing turned off",
      );
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function onCancel() {
    if (!confirm("Cancel this job?")) return;
    try {
      await cancelJob(id!);
      success("Job cancelled");
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function toggleSave() {
    try {
      if (saved) {
        await removeFavorite("job", id!);
        setSaved(false);
        success("Removed from saved");
      } else {
        await addFavorite("job", id!);
        setSaved(true);
        success("Saved job");
      }
    } catch (e) {
      error((e as Error).message);
    }
  }

  return {
    bestValueBlend,
    bestValueExplain,
    bestValueWeights,
    bids,
    bulkConfirmOpen,
    bulkMessage,
    bulkMode,
    competingBids,
    confirmBulkInvite,
    confirmInvite,
    confirmShortlistBulkInvite,
    cooldownByPro,
    counterAmount,
    counterAnalytics,
    counterBidId,
    counterBusy,
    counterNegotiationSpark,
    counterNotes,
    error,
    highlightBidId,
    hoNoteTemplates,
    id,
    inviteAnalytics,
    inviteBusy,
    inviteHistory,
    inviteMessage,
    inviteQuota,
    inviteRank,
    inviteSmartScore,
    inviteSource,
    inviteTemplates,
    invitedIds,
    invitingProId,
    job,
    load,
    loadAbort,
    loadSeq,
    loading,
    navigate,
    nowTick,
    onAccept,
    onCancel,
    onComplete,
    onCounterOffer,
    onInvitePro,
    onPhotoConsent,
    peerBestValueCounterHint,
    proAvailability,
    proBlockedDates,
    proReview,
    quoteViewedSent,
    refreshInvites,
    review,
    saved,
    scorePro,
    searchParams,
    selectedInviteIds,
    setBestValueExplain,
    setBestValueWeights,
    setBids,
    setBulkConfirmOpen,
    setBulkMessage,
    setBulkMode,
    setCounterAmount,
    setCounterAnalytics,
    setCounterBidId,
    setCounterBusy,
    setCounterNotes,
    setHighlightBidId,
    setHoNoteTemplates,
    setInviteAnalytics,
    setInviteBusy,
    setInviteHistory,
    setInviteMessage,
    setInviteQuota,
    setInviteRank,
    setInviteSmartScore,
    setInviteSource,
    setInvitedIds,
    setInvitingProId,
    setJob,
    setLoading,
    setNowTick,
    setProAvailability,
    setProBlockedDates,
    setProReview,
    setReview,
    setSaved,
    setScorePro,
    setSearchParams,
    setSelectedInviteIds,
    setShortlistBulkMsg,
    setShortlistBulkOpen,
    setShortlistFunnel,
    setShortlistMinHeat,
    setShortlistPros,
    setShortlistSelected,
    setShowDispute,
    setSuggestedPros,
    setTplLabel,
    setWhatIfByBid,
    setWhatIfCustom,
    shortlistBulkMsg,
    shortlistBulkOpen,
    shortlistFunnel,
    shortlistMinHeat,
    shortlistPros,
    shortlistSelected,
    showDispute,
    sideBySideWhatIf,
    success,
    suggestedPros,
    toggleSave,
    toggleSelectPro,
    tplLabel,
    updateProfile,
    user,
    whatIfByBid,
    whatIfCustom,
  };
}

export type JobDetailState = ReturnType<typeof useJobDetail>;
