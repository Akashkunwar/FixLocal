import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
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
  mediaUrl,
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
} from "../../api/jobs";
import { getJobReview, addFavorite, removeFavorite, listFavorites, type JobReview } from "../../api/extras";
import { Badge } from "../../components/ui/Badge";
import { ResponseSlaBadge } from "../../components/ui/ResponseSlaBadge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusTimeline } from "../../components/ui/StatusTimeline";
import { StarRating } from "../../components/ui/StarRating";
import { Countdown } from "../../components/Countdown";
import { CounterAmountSparkline } from "./job/CounterAmountSparkline";
import { ReviewPanel } from "./job/ReviewPanel";
import { DisputeForm } from "./job/DisputeForm";
import { ShortlistFunnelPanel } from "./job/ShortlistFunnelPanel";
import { InviteHistoryList } from "./job/InviteHistoryList";
import { CounterAnalyticsPanel } from "./job/CounterAnalyticsPanel";
import { JobConversations } from "../../components/JobConversations";
import { ReportButton } from "../../components/ReportButton";
import { ApiError, isAbort } from "../../api/client";
import { PaymentPanel } from "../../components/PaymentPanel";
import { CompletionPhotosPanel } from "../../components/CompletionPhotosPanel";
import { SchedulePanel } from "../../components/SchedulePanel";
import { VisitPrepCard } from "../../components/VisitPrepCard";
import { AmcProposalCard } from "../../components/AmcProposalCard";
import { clientPath } from "../../lib/paths";
import { cadenceLabel, normalizeCadence } from "../../lib/jobCadence";
import { saveRepeatDraft } from "../../lib/repeatJob";
import {
  mergeNamedJobTemplates,
  namedTemplateFromJob,
  upsertNamedJobTemplate,
} from "../../lib/namedJobTemplates";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../auth/AuthContext";
import { categoryEmoji, categoryLabel, fmtDate, fmtDateTime, money } from "../../lib/format";
import { Heart, MapPin, Send, Users, Info, BarChart3 } from "lucide-react";
import { MatchScorePanel } from "../../components/MatchScorePanel";
import { mergeInviteTemplates } from "../../lib/inviteTemplates";
import { upsertTextTemplate } from "../../lib/textTemplates";
import {
  normalizeWeeklyAvailability,
  type WeeklyAvailability,
} from "../../lib/availability";
import { previewEscrowSplit, escrowHoldAmount } from "../../lib/escrowWhatIf";
import {
  DEFAULT_HOMEOWNER_COUNTER_NOTES,
  mergeHomeownerCounterNotes,
  type HomeownerCounterNoteTemplate,
} from "../../lib/homeownerCounterNotes";
import {
  BestValueExplainPanel,
  type BestValueExplainRow,
} from "../../components/BestValueExplainPanel";



export function JobDetailPage() {
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
  const [proAvailability, setProAvailability] = useState<WeeklyAvailability | null>(null);
  const [proBlockedDates, setProBlockedDates] = useState<string[]>([]);
  const [suggestedPros, setSuggestedPros] = useState<SuggestedPro[]>([]);
  const [invitingProId, setInvitingProId] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [inviteHistory, setInviteHistory] = useState<JobInvite[]>([]);
  const [inviteQuota, setInviteQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [inviteAnalytics, setInviteAnalytics] = useState<InviteAnalytics | null>(null);
  const [shortlistFunnel, setShortlistFunnel] = useState<ShortlistInviteAnalytics | null>(null);
  const [inviteSource, setInviteSource] = useState<"shortlist" | "suggested" | "profile">("suggested");
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
      responseSla?: any;
      availabilityHeat?: { score: number; totalHours: number; clean: boolean } | null;
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
  const inviteTemplates = useMemo(() => mergeInviteTemplates(user?.inviteTemplates), [user?.inviteTemplates]);
  const [tplLabel, setTplLabel] = useState("");
  const [highlightBidId, setHighlightBidId] = useState<string | null>(null);
  const [counterBidId, setCounterBidId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNotes, setCounterNotes] = useState("");
  const [hoNoteTemplates, setHoNoteTemplates] = useState<HomeownerCounterNoteTemplate[]>(
    DEFAULT_HOMEOWNER_COUNTER_NOTES
  );
  const [bestValueWeights, setBestValueWeights] = useState({
    matchPct: 55,
    pricePct: 45,
    slaHeatPct: 0,
  });
  const [bestValueExplain, setBestValueExplain] = useState<BestValueExplainRow | null>(null);
  const [counterBusy, setCounterBusy] = useState(false);
  const [counterAnalytics, setCounterAnalytics] = useState<CounterAnalytics | null>(null);
  const [whatIfByBid, setWhatIfByBid] = useState<Record<string, EscrowWhatIf | null>>({});
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
      if (b.bestValueBlend?.matchPct != null && b.bestValueBlend?.pricePct != null) {
        setBestValueWeights({
          matchPct: Number(b.bestValueBlend.matchPct),
          pricePct: Number(b.bestValueBlend.pricePct),
          slaHeatPct: Number(b.bestValueBlend.slaHeatPct ?? 0),
        });
      }
      setHoNoteTemplates(mergeHomeownerCounterNotes(user?.homeownerCounterTemplates));
      setReview(r?.review ?? null);
      setProReview(r?.proReview ?? null);

      const accepted = b.bids.find((x) => x.id === j.job.acceptedBidId);
      const isOpen = j.job.status === "open";
      const [pub, suggested, inv, inviteStats, counters, ranked] = await Promise.all([
        accepted?.tradespersonId ? soft(getPublicProfile(accepted.tradespersonId)) : Promise.resolve(null),
        isOpen ? soft(getSuggestedPros(id, 5)) : Promise.resolve(null),
        soft(listJobInvites(id)),
        soft(getJobInviteAnalytics(id)),
        soft(getCounterAnalytics({ jobId: id })),
        soft(getShortlistRanked(id)),
      ]);
      if (!current()) return;
      setProAvailability(
        pub?.profile.weeklyAvailability ? normalizeWeeklyAvailability(pub.profile.weeklyAvailability) : null
      );
      setProBlockedDates(pub?.profile.blockedDates || []);
      setSuggestedPros(suggested?.suggestions || []);
      setInviteHistory(inv?.invites || []);
      setInviteQuota(inv ? { used: inv.used, limit: inv.limit, remaining: inv.remaining } : null);
      if (inv) {
        const pendingIds = inv.invites.filter((x) => x.status === "pending").map((x) => x.tradespersonId);
        setInvitedIds((prev) => [...new Set([...prev, ...pendingIds])]);
      }
      setInviteAnalytics(inviteStats);
      setCounterAnalytics(counters);

      if (ranked) {
        if (ranked.shortlistInviteMinHeat != null) setShortlistMinHeat(Number(ranked.shortlistInviteMinHeat) || 25);
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
          }))
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
              responseSla: (f.pro?.responseSla as SuggestedPro["responseSla"]) || null,
            }))
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
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = ids.filter((id) => shortlistPros.some((p) => p.userId === id));
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
    const clear = window.setTimeout(() => setHighlightBidId((cur) => (cur === target ? null : cur)), 6000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clear);
    };
  }, [bids, searchParams]);

  // Wave 17: soft pro alert when homeowner views a revised quote
  useEffect(() => {
    if (!job || job.status !== "open") return;
    const revised = bids.filter(
      (b) => b.status === "active" && Array.isArray(b.quoteHistory) && b.quoteHistory.length > 0
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
      .map((i) => (i.inCooldown && i.cooldownUntil ? new Date(i.cooldownUntil).getTime() : 0))
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const tmr = window.setTimeout(() => setNowTick(Date.now()), next - now + 50);
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
      prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]
    );
  }

  async function onInvitePro(
    pro: SuggestedPro,
    opts?: { source?: "shortlist" | "suggested" | "profile"; shortlistRank?: number; smartScore?: number }
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
      setInviteQuota({ used: inv.used, limit: inv.limit, remaining: inv.remaining });
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
      setInvitedIds((prev) => (prev.includes(invitingProId) ? prev : [...prev, invitingProId]));
      setInvitingProId(null);
      setInviteMessage("");
      setInviteSource("suggested");
      setInviteRank(null);
      setInviteSmartScore(null);
      await refreshInvites();
    } catch (e: any) {
      if (e?.code === "ALREADY_INVITED") {
        setInvitedIds((prev) =>
          invitingProId && !prev.includes(invitingProId) ? [...prev, invitingProId] : prev
        );
        setInvitingProId(null);
        setInviteMessage("");
        error(e.message || "Already invited");
        await refreshInvites();
      } else if (e?.code === "INVITE_COOLDOWN") {
        error(e.message || "Invite cooldown");
        await refreshInvites();
      } else if (e?.code === "SHORTLIST_HEAT_TOO_LOW") {
        error(e.message || "Pro availability heat too low for shortlist invite");
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
    } catch (e: any) {
      error(e.message || "Bulk invite failed");
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
      error(`All selected pros are below heat ≥${shortlistMinHeat} (clean schedules only)`);
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
    } catch (e: any) {
      error(e.message || "Shortlist bulk invite failed");
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
      return { bid: b, hold, split, name, source: Number(b.quoteAmount) > 0 ? "quote" : "bid" };
    });
    // Clean = all have positive hold and 3 milestones
    if (!rows.every((r) => r.hold > 0 && r.split.milestones.length === 3)) return null;
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
      (b) => Number(b.heatBoost || 0) + slaTierPoints(b.responseSla?.tier)
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
      const slaHeatRaw = Number(b.heatBoost || 0) + slaTierPoints(b.responseSla?.tier);
      const matchNorm = (score - minScore) / scoreSpan;
      const priceNorm = (maxHold - hold) / holdSpan;
      const slaHeatNorm = (slaHeatRaw - minSla) / slaSpan;
      const valueScore =
        Math.round(
          (matchW * matchNorm + priceW * priceNorm + slaW * slaHeatNorm) * 1000
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
    const best = peers.find((r) => r.bidId === bestValueBlend.bestBidId) || peers[0];
    const avgHold = Math.round(
      peers.slice(0, 3).reduce((s, r) => s + r.hold, 0) / Math.min(3, peers.length)
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
    const points: { t: number; amount: number; label: string; status: string; bidId: string }[] = [];
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
              Math.abs(p.amount - Number(b.counterOffer!.suggestedAmount)) < 0.5
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
      const active = bids.filter((b) => b.status === "active" || b.status === "accepted");
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
        })
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
    } catch (e: any) {
      error(e.message || "Could not send counter-offer");
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
        .map((m) => `  ${m.sequence}. ${m.label} (${m.percent}%) · ₹${Number(m.amount).toFixed(0)}`)
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
            : `Accepted · ₹${Number(amt).toFixed(0)} held from bid (simulated escrow)`
      );
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED") {
        const now = Number(e.details?.currentAmount);
        error(
          `The professional changed their quote${Number.isFinite(now) ? ` to ₹${now.toFixed(0)}` : ""}. Review the new amount and accept again.`
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
        : "Mark this job complete now? Any payment still held will be released to the professional, even though they haven't marked the work done."
    );
    if (!ok) return;
    try {
      const r = await confirmJobComplete(id!);
      if (r.autoReleased && r.autoReleased.count > 0) {
        success(`Job completed — ${r.autoReleased.count} remaining payment milestone(s) released`);
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
      success(consent ? "The professional may publish photos from this job" : "Photo publishing turned off");
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
    } catch (e: any) {
      error(e.message);
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
    } catch (e: any) {
      error(e.message);
    }
  }

  if (loading || !job) {
    return (
      <Shell title="Job">
        <Spinner />
      </Shell>
    );
  }

  const sortedBids = [...bids].sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
  const liveWork = ["awarded", "in_progress", "pending_confirmation"].includes(job.status);
  const hired = liveWork || job.status === "completed" || job.status === "disputed";
  const canMessage = job.status === "open" || hired || (job.status === "cancelled" && !!job.acceptedBidId);
  const showEscrow =
    !!job.acceptedBidId ||
    ["held", "partially_released", "released", "refunded", "simulated_paid"].includes(
      job.paymentStatus || ""
    );

  return (
    <Shell
      title={job.title}
      subtitle={`${categoryEmoji(job.category)} ${categoryLabel(job.category)}${
          job.cadence && normalizeCadence(job.cadence) !== "one_time"
            ? ` · ${cadenceLabel(job.cadence)}`
            : ""
        } · Posted ${fmtDate(job.createdAt)}`}
      actions={
        <button type="button" className="btn-secondary btn-sm" onClick={toggleSave} aria-label="Save job">
          <Heart className={`h-4 w-4 ${saved ? "fill-rose-500 text-rose-500" : ""}`} />
          {saved ? "Saved" : "Save"}
        </button>
      }
    >
      <div className="mb-6 card p-5">
        <StatusTimeline status={job.status} />
        {job.scheduledStart && (
          <p className="mt-3 text-sm text-slate-600">
            Visit {job.scheduleStatus === "confirmed" ? "confirmed" : "proposed"}:{" "}
            <strong>{fmtDateTime(job.scheduledStart)}</strong>
            {job.scheduledEnd ? ` – ${fmtDateTime(job.scheduledEnd)}` : ""}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="card p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={job.status} />
              {job.paymentStatus && <Badge status={job.paymentStatus} />}
              {job.scheduleStatus && job.scheduleStatus !== "none" && (
                <Badge status={job.scheduleStatus} />
              )}
            </div>
            <p className="text-slate-700 whitespace-pre-wrap">{job.description}</p>
            <div className="flex flex-wrap gap-4 text-sm text-slate-500">
              {(job.area || job.address) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {[job.address, job.area, job.pincode].filter(Boolean).join(", ")}
                </span>
              )}
              <span>
                Budget {money(job.budgetMin)} – {money(job.budgetMax)}
              </span>
              <span>Max bids {job.maxBids}</span>
            </div>
            {job.photoUrls?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {job.photoUrls.map((u) => (
                  <a key={u} href={mediaUrl(u)} target="_blank" rel="noreferrer">
                    <img
                      src={mediaUrl(u)}
                      alt=""
                      className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
                    />
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {liveWork && (
                <button
                  type="button"
                  className={job.status === "pending_confirmation" ? "btn-primary" : "btn-secondary"}
                  onClick={onComplete}
                >
                  {job.status === "pending_confirmation" ? "Confirm work is complete" : "Mark completed"}
                </button>
              )}
              {job.status === "completed" && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      saveRepeatDraft(job);
                      success("Prefilling post-job wizard from this job");
                      navigate(clientPath("jobs/new"));
                    }}
                  >
                    Repeat this job
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      const suggested =
                        (job.title || "Job").replace(/\s*\(repeat\)\s*$/i, "").trim() ||
                        "My job template";
                      const name =
                        window.prompt("Name this job template", suggested)?.trim() ||
                        suggested;
                      const entry = namedTemplateFromJob(job, name);
                      try {
                        await updateProfile({
                          namedJobTemplates: upsertNamedJobTemplate(
                            mergeNamedJobTemplates(user?.namedJobTemplates),
                            entry
                          ),
                        });
                        success(`Saved “${entry.name}” to your job templates`);
                      } catch (e) {
                        error((e as Error).message || "Couldn't save the template");
                      }
                    }}
                  >
                    Save as template
                  </button>
                </>
              )}
              {job.status === "open" && (
                <button type="button" className="btn-danger" onClick={onCancel}>
                  Cancel job
                </button>
              )}
              {(liveWork || job.status === "completed") && (
                <button type="button" className="btn-secondary" onClick={() => setShowDispute(true)}>
                  Open dispute
                </button>
              )}
            </div>
            {job.status === "pending_confirmation" && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
                The professional marked this job as done. Confirm to release the remaining payment, or open a
                dispute if something isn't right. It will be confirmed automatically in a few days if you don't respond.
              </p>
            )}
            {showDispute && (
              <DisputeForm
                jobId={job.id}
                onCancel={() => setShowDispute(false)}
                onOpened={() => {
                  setShowDispute(false);
                  load();
                }}
              />
            )}
          </section>

          {liveWork && (
            <SchedulePanel
              job={job}
              userId={user?.id}
              canManage
              onChanged={load}
              proAvailability={proAvailability}
              blockedDates={proBlockedDates}
            />
          )}

          {(job.status === "awarded" || job.status === "in_progress") && <VisitPrepCard job={job} />}
          {job.cadence && normalizeCadence(job.cadence) !== "one_time" && (
            <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900 ring-1 ring-violet-100">
              <span className="font-semibold">Cadence preference:</span>{" "}
              {cadenceLabel(job.cadence)}
              {job.cadenceNote ? ` — ${job.cadenceNote}` : ""}
              . Soft only — negotiate schedule in chat.
            </p>
          )}

          {(liveWork || job.status === "completed") && <AmcProposalCard job={job} role="client" onChanged={load} />}

          {showEscrow && (
            <PaymentPanel
              job={job}
              canRelease={liveWork || job.status === "completed"}
              onChanged={load}
            />
          )}

          {hired && (
            <CompletionPhotosPanel job={job} canEdit={hired} onChanged={load} />
          )}

          {job.status === "completed" && (job.beforePhotoUrls?.length || job.afterPhotoUrls?.length) ? (
            <section className="card p-5">
              <label className="flex items-start gap-3 text-sm" htmlFor="photo-consent">
                <input
                  id="photo-consent"
                  type="checkbox"
                  className="mt-1"
                  checked={!!job.photoConsent}
                  onChange={(e) => onPhotoConsent(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-900">Allow the professional to show these photos in their portfolio</span>
                  <span className="block text-slate-500">
                    Only the completion photos are shared, never your address. You can turn this off at any time.
                  </span>
                </span>
              </label>
            </section>
          ) : null}

          {job.status === "open" && shortlistPros.length > 0 && (
            <section className="card p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Invite from shortlist</h2>
                  <p className="text-xs text-slate-500">
                    Smart-ranked for this job (match score + tag boost) · notes &amp; tags from Favorites
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={shortlistBulkOpen ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                    onClick={() => {
                      setShortlistBulkOpen((v) => !v);
                      if (shortlistBulkOpen) setShortlistSelected([]);
                    }}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {shortlistBulkOpen ? "Cancel multi" : "Invite multiple"}
                  </button>
                  <Link to="/client/favorites" className="text-xs text-brand-700 no-underline hover:underline">
                    Manage shortlist
                  </Link>
                </div>
              </div>
              <ul className="space-y-2">
                {shortlistPros.map((pro, rankIdx) => {
                  const already = invitedIds.includes(pro.userId) || inviteHistory.some((i) => i.tradespersonId === pro.userId && i.status === "pending");
                  const hasBid = bids.some((b) => b.tradespersonId === pro.userId);
                  const selected = shortlistSelected.includes(pro.userId);
                  const disabledInvite = already || hasBid;
                  return (
                    <li
                      key={pro.userId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {shortlistBulkOpen && (
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={disabledInvite}
                            checked={selected}
                            onChange={() =>
                              setShortlistSelected((prev) =>
                                selected ? prev.filter((x) => x !== pro.userId) : [...prev, pro.userId]
                              )
                            }
                          />
                        )}
                        <div className="min-w-0">
                          <Link
                            to={`/pros/${pro.userId}`}
                            className="font-medium text-slate-900 no-underline hover:text-brand-700"
                          >
                            {pro.name || "Pro"}
                          </Link>
                          <p className="text-xs text-slate-500 truncate max-w-md">{pro.skills || "—"}</p>
                          <div className="mt-1 flex flex-wrap gap-1 items-center">
                            {pro.smartScore != null && (
                              <span
                                className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 ring-1 ring-brand-200"
                                title={
                                  pro.tagBoost
                                    ? `Match ${pro.score} + tag boost ${pro.tagBoost}`
                                    : `Match score ${pro.score}`
                                }
                              >
                                Match {pro.smartScore}
                              </span>
                            )}
                            {!!pro.tagBoost && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900 ring-1 ring-amber-200">
                                +{pro.tagBoost} tags
                              </span>
                            )}
                            {pro.responseSla && <ResponseSlaBadge sla={pro.responseSla} compact />}
                            {pro.availabilityHeat?.clean && (
                              <span
                                className={
                                  pro.inviteBlockedByHeat
                                    ? "rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 ring-1 ring-rose-200"
                                    : "rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                                }
                                title={
                                  pro.inviteBlockedByHeat
                                    ? pro.inviteHeatReason || `Needs heat ≥${pro.shortlistInviteMinHeat ?? shortlistMinHeat}`
                                    : `Availability heat ${pro.availabilityHeat.score}`
                                }
                              >
                                Heat {pro.availabilityHeat.score}
                                {pro.inviteBlockedByHeat ? " · blocked" : ""}
                              </span>
                            )}
                            {(pro.tags || []).map((t) => (
                              <span
                                key={t}
                                className={
                                  (pro.tagHits || []).includes(t)
                                    ? "rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-950 ring-1 ring-amber-300"
                                    : "rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200"
                                }
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                          {pro.notes && (
                            <p className="mt-0.5 text-[11px] italic text-slate-500 truncate max-w-md">“{pro.notes}”</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasBid ? (
                          <span className="text-[10px] uppercase tracking-wide text-violet-800 bg-violet-50 px-1.5 py-0.5 rounded-full">
                            bid received
                          </span>
                        ) : already ? (
                          <span className="text-[10px] uppercase tracking-wide text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            invited
                          </span>
                        ) : pro.inviteBlockedByHeat ? (
                          <span
                            className="max-w-[9rem] text-right text-[10px] text-rose-700"
                            title={pro.inviteHeatReason || undefined}
                          >
                            Heat below {pro.shortlistInviteMinHeat ?? shortlistMinHeat} — invite blocked
                          </span>
                        ) : !shortlistBulkOpen ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={inviteBusy}
                            onClick={() =>
                              onInvitePro(
                                {
                                  userId: pro.userId,
                                  name: pro.name || null,
                                  city: null,
                                  skills: pro.skills || null,
                                  averageRating: Number(pro.averageRating || 0),
                                  reviewCount: Number(pro.reviewCount || 0),
                                  score: Number(pro.score || 0),
                                  breakdown: {
                                    skills: 0,
                                    rating: 0,
                                    response: 0,
                                    distance: 0,
                                    total: 0,
                                    skillHits: [],
                                    distanceKm: null,
                                    avgResponseHours: null,
                                  },
                                },
                                {
                                  source: "shortlist",
                                  shortlistRank: rankIdx + 1,
                                  smartScore: pro.smartScore,
                                }
                              )
                            }
                          >
                            Invite
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {shortlistBulkOpen && (
                <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3 space-y-2">
                  <p className="text-sm text-slate-700">
                    {shortlistSelected.length} selected
                  </p>
                  <textarea
                    className="input min-h-[60px]"
                    placeholder="Optional shared message"
                    value={shortlistBulkMsg}
                    onChange={(e) => setShortlistBulkMsg(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={inviteBusy || shortlistSelected.length === 0}
                    onClick={confirmShortlistBulkInvite}
                  >
                    {inviteBusy ? "Sending…" : `Invite ${shortlistSelected.length || ""} from shortlist`}
                  </button>
                </div>
              )}
            </section>
          )}

          {shortlistFunnel && shortlistFunnel.ranked > 0 && <ShortlistFunnelPanel funnel={shortlistFunnel} />}

          {job.status === "open" && (suggestedPros.length > 0 || inviteHistory.length > 0) && (
            <section className="card p-4 sm:p-6 space-y-4">
              {suggestedPros.length > 0 && (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold">Suggested pros</h2>
                      <p className="text-xs text-slate-500 mb-1">
                        Ranked by skills ∩ category, rating, response time, and distance (max 100). Invite sends an in-app notification.
                        {inviteQuota && (
                          <> · {inviteQuota.used}/{inviteQuota.limit} invites used</>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={bulkMode ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                      onClick={() => {
                        setBulkMode((v) => !v);
                        setBulkConfirmOpen(false);
                        setSelectedInviteIds([]);
                      }}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {bulkMode ? "Cancel multi" : "Invite multiple"}
                    </button>
                  </div>
                  <ul className="space-y-3">
                    {suggestedPros.map((p) => {
                      const already = invitedIds.includes(p.userId);
                      const cool = cooldownByPro.get(p.userId);
                      const coolMs = cool?.cooldownUntil
                        ? Math.max(0, new Date(cool.cooldownUntil).getTime() - nowTick)
                        : 0;
                      const inCool = coolMs > 0;
                      const selected = selectedInviteIds.includes(p.userId);
                      const disabledInvite = already || inCool;
                      return (
                        <li
                          key={p.userId}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
                        >
                          <div className="min-w-0 flex-1 flex gap-2">
                            {bulkMode && (
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={selected}
                                disabled={disabledInvite}
                                onChange={() => toggleSelectPro(p.userId)}
                                aria-label={`Select ${p.name || "pro"}`}
                              />
                            )}
                            <div className="min-w-0">
                              <Link
                                to={`/pros/${p.userId}`}
                                className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                              >
                                {p.name || "Verified pro"}
                              </Link>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {[p.city, p.skills].filter(Boolean).join(" · ") || "—"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-400">
                                ★ {p.averageRating.toFixed(1)} ({p.reviewCount})
                                {p.breakdown.distanceKm != null && (
                                  <> · ~{p.breakdown.distanceKm} km</>
                                )}
                                {p.breakdown.avgResponseHours != null && (
                                  <> · ~{p.breakdown.avgResponseHours}h response</>
                                )}
                                {p.responseSla && (
                                  <span className="ml-2 inline-flex align-middle">
                                    <ResponseSlaBadge sla={p.responseSla} compact />
                                  </span>
                                )}
                              </p>
                              {inCool && (
                                <p className="mt-1 text-[11px] font-medium text-amber-800">
                                  Cooldown · retry in <Countdown until={cool!.cooldownUntil!} />
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="text-right rounded-lg px-1.5 py-0.5 hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-brand-300"
                              onClick={() => setScorePro(p)}
                              title="Explain match score (sk/rt/rs/ds)"
                            >
                              <p className="text-2xl font-bold text-brand-800">
                                {(p.rankedScore ?? p.score).toFixed(0)}
                              </p>
                              <p className="text-[10px] uppercase tracking-wide text-slate-400 flex items-center justify-end gap-0.5">
                                match <Info className="h-3 w-3" />
                              </p>
                              {(p.heatBoost != null && p.heatBoost > 0) || p.availabilityHeat?.clean ? (
                                <p className="text-[10px] text-emerald-700">
                                  {p.heatBoost ? `+${p.heatBoost} heat` : "heat"}
                                  {p.availabilityHeat?.clean
                                    ? ` · ${p.availabilityHeat.score}`
                                    : ""}
                                </p>
                              ) : null}
                            </button>
                            {!bulkMode && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm touch-target"
                                disabled={disabledInvite}
                                onClick={() => onInvitePro(p)}
                                title={
                                  already
                                    ? "Already invited"
                                    : inCool
                                      ? `Cooldown until ${new Date(cool!.cooldownUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                                      : "Invite to bid"
                                }
                              >
                                <Send className="h-3.5 w-3.5" />
                                {already ? "Invited" : inCool ? "Cooldown" : "Invite"}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {bulkMode && (
                    <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100 space-y-3">
                      <p className="text-sm font-medium text-brand-950">
                        {selectedInviteIds.length} pro{selectedInviteIds.length === 1 ? "" : "s"} selected
                        {inviteQuota ? ` · ${inviteQuota.remaining} invites left on this job` : ""}
                      </p>
                      {!bulkConfirmOpen ? (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={selectedInviteIds.length === 0 || inviteBusy}
                          onClick={() => setBulkConfirmOpen(true)}
                        >
                          Continue…
                        </button>
                      ) : (
                        <>
                          <div>
                            <label className="label">Optional shared message</label>
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {inviteTemplates.slice(0, 6).map((tpl) => (
                                <button
                                  key={`b-${tpl.id}`}
                                  type="button"
                                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                                  onClick={() => setBulkMessage(tpl.body)}
                                >
                                  {tpl.label}
                                </button>
                              ))}
                            </div>
                            <textarea
                              className="input min-h-[72px]"
                              maxLength={500}
                              placeholder="Optional note for all selected pros"
                              value={bulkMessage}
                              onChange={(e) => setBulkMessage(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={inviteBusy || selectedInviteIds.length === 0}
                              onClick={confirmBulkInvite}
                            >
                              {inviteBusy
                                ? "Sending…"
                                : `Send ${selectedInviteIds.length} invite${selectedInviteIds.length === 1 ? "" : "s"}`}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={inviteBusy}
                              onClick={() => setBulkConfirmOpen(false)}
                            >
                              Back
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {invitingProId && !bulkMode && (
                    <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100 space-y-3">
                      <p className="text-sm font-medium text-brand-950">
                        Invite{" "}
                        {suggestedPros.find((x) => x.userId === invitingProId)?.name || "pro"} to bid?
                      </p>
                      <div>
                        <label className="label">Optional message</label>
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {inviteTemplates.slice(0, 8).map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                              onClick={() => setInviteMessage(tpl.body)}
                              title={tpl.body}
                            >
                              {tpl.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className="input min-h-[72px]"
                          maxLength={500}
                          placeholder="e.g. Flexible on timing, need someone this week"
                          value={inviteMessage}
                          onChange={(e) => setInviteMessage(e.target.value)}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            className="input !py-1.5 text-xs max-w-[140px]"
                            placeholder="Template label"
                            value={tplLabel}
                            onChange={(e) => setTplLabel(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={!inviteMessage.trim()}
                            onClick={async () => {
                              if (!inviteMessage.trim()) return;
                              try {
                                await updateProfile({
                                  inviteTemplates: upsertTextTemplate(
                                    inviteTemplates,
                                    { label: tplLabel.trim() || "Saved", body: inviteMessage },
                                    "tpl"
                                  ),
                                });
                                setTplLabel("");
                                success("Invite template saved");
                              } catch (e) {
                                error((e as Error).message || "Couldn't save template");
                              }
                            }}
                          >
                            Save template
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary btn-sm touch-target"
                          disabled={inviteBusy}
                          onClick={confirmInvite}
                        >
                          {inviteBusy ? "Sending…" : "Send invite"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm touch-target"
                          disabled={inviteBusy}
                          onClick={() => {
                            setInvitingProId(null);
                            setInviteSource("suggested");
                            setInviteRank(null);
                            setInviteSmartScore(null);
                            setInviteMessage("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {inviteAnalytics && inviteAnalytics.sent > 0 && (
                <div className={suggestedPros.length > 0 ? "border-t border-slate-100 pt-4" : ""}>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-4 w-4 text-brand-700" />
                    <h3 className="text-sm font-semibold text-slate-900">Invite analytics</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: "Sent", value: inviteAnalytics.sent },
                      { label: "Declined", value: inviteAnalytics.declined, sub: `${inviteAnalytics.declineRate}%` },
                      { label: "Opened", value: inviteAnalytics.opened, sub: `${inviteAnalytics.openRate}%` },
                      { label: "Bid after", value: inviteAnalytics.bidAfterInvite, sub: `${inviteAnalytics.bidRate}%` },
                    ].map((c) => (
                      <div key={c.label} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.label}</p>
                        <p className="text-xl font-bold text-slate-900">{c.value}</p>
                        {"sub" in c && c.sub ? (
                          <p className="text-[11px] text-slate-500">{c.sub}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Opened ≈ notification read or deep-link visit · Click-ish tracked when pros open the invite job link
                  </p>
                </div>
              )}

              {inviteHistory.length > 0 && (
                <div className={suggestedPros.length > 0 || (inviteAnalytics && inviteAnalytics.sent > 0) ? "border-t border-slate-100 pt-4" : ""}>
                  <InviteHistoryList invites={inviteHistory} quota={inviteQuota} now={nowTick} />
                </div>
              )}
            </section>
          )}

          <section className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Bids ({bids.length})</h2>
              <p className="text-xs text-slate-500">
                Compare price · match · best value
                {Number(bestValueWeights.slaHeatPct ?? 0) > 0 ? " (+ SLA/heat)" : ""} · escrow what-if
              </p>
            </div>

            {counterAnalytics && counterAnalytics.sent > 0 && <CounterAnalyticsPanel stats={counterAnalytics} />}

            {bestValueBlend && job.status === "open" && (
              <div className="mb-4 rounded-xl bg-sky-50/80 p-3 ring-1 ring-sky-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  Best value · match + escrow
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0 ? " + SLA/heat" : ""}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Blend of match/ranked ({bestValueBlend.matchPct}%) and lower simulated escrow hold (
                  {bestValueBlend.pricePct}%)
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                    ? ` plus response SLA + availability heat (${bestValueBlend.slaHeatPct}%)`
                    : ""}
                  . Higher is better · admin-tunable (audited).
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {bestValueBlend.rows.map((row) => (
                    <div
                      key={row.bidId}
                      className={
                        row.bidId === bestValueBlend.bestBidId
                          ? "rounded-xl bg-white p-3 ring-2 ring-sky-400"
                          : "rounded-xl bg-white/90 p-3 ring-1 ring-sky-100"
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                        {row.bidId === bestValueBlend.bestBidId && (
                          <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            Best value
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-lg font-bold text-sky-900">{row.valueScore}</p>
                      <p className="text-[11px] text-slate-500">
                        Match {row.matchScore.toFixed(0)} · hold {money(row.hold)}
                        {Number(bestValueBlend.slaHeatPct ?? 0) > 0 && row.slaHeatRaw != null
                          ? ` · SLA/heat ${Number(row.slaHeatRaw).toFixed(0)}`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a
                          href={`#bid-${row.bidId}`}
                          className="inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                        >
                          Jump to bid
                        </a>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-sky-800 underline-offset-2 hover:underline"
                          onClick={() =>
                            setBestValueExplain({
                              ...row,
                              isBest: row.bidId === bestValueBlend.bestBidId,
                            })
                          }
                        >
                          Why this score?
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {counterNegotiationSpark && (
              <div className="mb-4 rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
                <h3 className="text-sm font-semibold text-slate-900">Counter negotiation timeline</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Suggested amounts over time across bids on this job (sparkline).
                </p>
                <CounterAmountSparkline points={counterNegotiationSpark} />
                <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-slate-600">
                  {counterNegotiationSpark.map((p, i) => (
                    <li key={`${p.bidId}-${p.t}-${i}`} className="flex flex-wrap gap-x-2">
                      <span className="text-slate-400">{new Date(p.t).toLocaleString()}</span>
                      <span className="font-medium">{p.label}</span>
                      <span>{money(p.amount)}</span>
                      <span className="text-slate-400">· {p.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sideBySideWhatIf && job.status === "open" && (
              <div className="mb-4 overflow-x-auto rounded-xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100">
                <h3 className="text-sm font-semibold text-slate-900">Escrow what-if · side-by-side</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Simulated Deposit / Progress / Completion if you accept each competing bid (no real charge).
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sideBySideWhatIf.map((row) => (
                    <div
                      key={row.bid.id}
                      className="rounded-xl bg-white/90 p-3 ring-1 ring-emerald-100"
                    >
                      <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                      <p className="text-[11px] text-slate-500">
                        Hold {money(row.hold)} · from {row.source}
                      </p>
                      <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                        {row.split.milestones.map((m) => (
                          <li key={m.label} className="flex justify-between gap-2">
                            <span>
                              {m.label}{" "}
                              <span className="text-slate-400">({m.percent}%)</span>
                            </span>
                            <span className="font-medium">{money(m.amount)}</span>
                          </li>
                        ))}
                      </ul>
                      <a
                        href={`#bid-${row.bid.id}`}
                        className="mt-2 inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                      >
                        Jump to bid
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sortedBids.length === 0 ? (
              <EmptyState
                title="No bids yet"
                description={
                  job.status === "open"
                    ? "Verified pros nearby will bid soon. You can also browse pros and invite them by sharing this job."
                    : "No bids were placed on this job."
                }
                action={
                  job.status === "open" ? (
                    <Link to="/client/pros" className="btn-secondary btn-sm no-underline">
                      Find pros
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-3">
                {sortedBids.map((b) => (
                  <li
                    key={b.id}
                    id={`bid-${b.id}`}
                    className={`rounded-xl border p-4 transition ring-offset-2 ${
                      highlightBidId === b.id
                        ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-400 shadow-md"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/pros/${b.tradespersonId}`}
                            className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                          >
                            {b.tradesperson?.name || b.tradesperson?.email || "Professional"}
                          </Link>
                          {bestValueBlend?.bestBidId === b.id && (
                            <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                              Best value
                            </span>
                          )}
                          {bestValueBlend?.rows.some((r) => r.bidId === b.id) && (
                            <button
                              type="button"
                              className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200"
                              onClick={() => {
                                const row = bestValueBlend.rows.find((r) => r.bidId === b.id);
                                if (row) {
                                  setBestValueExplain({
                                    ...row,
                                    isBest: row.bidId === bestValueBlend.bestBidId,
                                  });
                                }
                              }}
                            >
                              Why value?
                            </button>
                          )}
                          {b.matchScore != null && Number.isFinite(Number(b.matchScore)) && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200">
                              Match {(b.rankedScore ?? b.matchScore).toFixed(0)}
                              {b.heatBoost ? ` · +${b.heatBoost} heat` : ""}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                          {b.profile && (
                            <>
                              <StarRating value={Math.round(b.profile.averageRating)} readonly size={14} />
                              <span>({b.profile.reviewCount})</span>
                              {b.profile.city && <span>· {b.profile.city}</span>}
                              {b.profile.yearsExperience != null && (
                                <span>· {b.profile.yearsExperience} yrs</span>
                              )}
                            </>
                          )}
                          {b.responseSla && <ResponseSlaBadge sla={b.responseSla} />}
                        </div>
                        {b.proSlaTrends?.clean && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-medium text-slate-600">Trends</span>
                            <span className="text-slate-400">7d</span>
                            <ResponseSlaBadge sla={b.proSlaTrends.d7} compact />
                            <span className="text-slate-400">30d</span>
                            <ResponseSlaBadge sla={b.proSlaTrends.d30} compact />
                          </p>
                        )}
                        {b.message && <p className="mt-2 text-sm text-slate-600">{b.message}</p>}
                        {b.etaDays != null && (
                          <p className="mt-1 text-xs text-slate-400">ETA: {b.etaDays} day(s)</p>
                        )}
                        {b.proposedVisitStart && (
                          <p className="mt-1 text-xs text-brand-700">
                            Proposed visit: {fmtDateTime(b.proposedVisitStart)}
                            {b.proposedVisitEnd ? ` – ${fmtDateTime(b.proposedVisitEnd)}` : ""}
                          </p>
                        )}
                        {(b.quoteAmount != null || b.quoteNotes || b.quoteAttachmentUrl || (b.quoteHistory && b.quoteHistory.length > 0)) && (
                          <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                              Quote / estimate
                              {b.quoteHistory && b.quoteHistory.length > 0
                                ? ` · ${b.quoteHistory.length} revision${b.quoteHistory.length === 1 ? "" : "s"}`
                                : ""}
                            </p>
                            {b.quoteAmount != null && (
                              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                                <p className="text-base font-bold text-amber-950">{money(b.quoteAmount)}</p>
                                {(() => {
                                  const hist = b.quoteHistory || [];
                                  if (!hist.length) return null;
                                  const prev = hist[hist.length - 1];
                                  if (prev?.amount == null) return null;
                                  const delta = Number(b.quoteAmount) - Number(prev.amount);
                                  if (!Number.isFinite(delta) || delta === 0) {
                                    return (
                                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                        no amount change
                                      </span>
                                    );
                                  }
                                  const down = delta < 0;
                                  return (
                                    <span
                                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                        down
                                          ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200"
                                          : "bg-rose-100 text-rose-900 ring-1 ring-rose-200"
                                      }`}
                                    >
                                      {down ? "↓" : "↑"} {down ? "" : "+"}
                                      {money(delta)} vs prior
                                    </span>
                                  );
                                })()}
                              </div>
                            )}
                            {b.quoteNotes && (
                              <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{b.quoteNotes}</p>
                            )}
                            {b.quoteAttachmentUrl && (
                              <a
                                href={mediaUrl(b.quoteAttachmentUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-xs font-medium text-brand-700 underline"
                              >
                                Open quote attachment
                              </a>
                            )}
                            {b.quoteHistory && b.quoteHistory.length > 0 && (
                              <div className="mt-2 border-t border-amber-200/80 pt-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  Revision diff
                                </p>
                                <ul className="mt-1 space-y-1.5">
                                  {(() => {
                                    const hist = [...b.quoteHistory];
                                    const timeline = [
                                      ...hist.map((h) => ({
                                        amount: h.amount,
                                        notes: h.notes,
                                        at: h.revisedAt,
                                        kind: "prior" as const,
                                      })),
                                      {
                                        amount: b.quoteAmount != null ? Number(b.quoteAmount) : null,
                                        notes: b.quoteNotes || null,
                                        at: null as string | null,
                                        kind: "current" as const,
                                      },
                                    ];
                                    const rows = [] as any[];
                                    for (let i = timeline.length - 1; i >= 1; i--) {
                                      const cur = timeline[i];
                                      const prev = timeline[i - 1];
                                      const dAmt =
                                        cur.amount != null && prev.amount != null
                                          ? Number(cur.amount) - Number(prev.amount)
                                          : null;
                                      const notesChanged = (cur.notes || null) !== (prev.notes || null);
                                      rows.push(
                                        <li
                                          key={`${prev.at || "x"}-${i}`}
                                          className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-slate-600 ring-1 ring-amber-100"
                                        >
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-slate-800">
                                              {prev.amount != null ? money(prev.amount) : "—"}
                                              {" → "}
                                              {cur.amount != null ? money(cur.amount) : "—"}
                                            </span>
                                            {dAmt != null && dAmt !== 0 && (
                                              <span
                                                className={
                                                  dAmt < 0
                                                    ? "font-semibold text-emerald-700"
                                                    : "font-semibold text-rose-700"
                                                }
                                              >
                                                ({dAmt > 0 ? "+" : ""}
                                                {money(dAmt)})
                                              </span>
                                            )}
                                            {cur.kind === "current" ? (
                                              <span className="rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-900">
                                                latest
                                              </span>
                                            ) : null}
                                            {prev.at && (
                                              <span className="text-slate-400">
                                                {new Date(prev.at).toLocaleString()}
                                              </span>
                                            )}
                                          </div>
                                          {notesChanged && (
                                            <div className="mt-0.5 space-y-0.5 text-slate-500">
                                              <p className="truncate">
                                                <span className="text-slate-400">was:</span>{" "}
                                                {prev.notes ? `“${prev.notes}”` : "—"}
                                              </p>
                                              <p className="truncate">
                                                <span className="text-slate-400">now:</span>{" "}
                                                {cur.notes ? `“${cur.notes}”` : "—"}
                                              </p>
                                            </div>
                                          )}
                                        </li>
                                      );
                                    }
                                    return rows;
                                  })()}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        {b.distanceKm != null && (
                          <p className="mt-1 text-xs text-slate-500">~{b.distanceKm} km from job</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-slate-900">{money(b.amount)}</p>
                        <Badge status={b.status} />
                        {job.status === "open" && b.status === "active" && (
                          <button
                            type="button"
                            className="btn-primary btn-sm mt-2"
                            onClick={() => onAccept(b.id)}
                          >
                            {b.quoteAmount != null && Number(b.quoteAmount) > 0
                              ? "Accept quote → escrow"
                              : "Accept → escrow"}
                          </button>
                        )}
                        {job.status === "open" &&
                          b.status === "active" &&
                          b.quoteAmount != null &&
                          Number(b.quoteAmount) > 0 && (
                            <p className="mt-1 max-w-[10rem] text-[11px] text-slate-500">
                              Escrow will use quote {money(b.quoteAmount)}
                            </p>
                          )}
                        {job.status === "open" && b.status === "active" && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm mt-2"
                            onClick={() => {
                              setCounterBidId(b.id);
                              const base =
                                b.quoteAmount != null && Number(b.quoteAmount) > 0
                                  ? Number(b.quoteAmount)
                                  : Number(b.amount);
                              setCounterAmount(
                                Number.isFinite(base) ? String(Math.max(1, Math.round(base * 0.9))) : ""
                              );
                              setCounterNotes("");
                            }}
                          >
                            Request revise
                          </button>
                        )}
                        {b.counterOffer && (
                          <p className="mt-2 max-w-[12rem] text-[11px] text-slate-600">
                            Counter {money(b.counterOffer.suggestedAmount)}
                            <span className="text-slate-400"> · {b.counterOffer.status}</span>
                          </p>
                        )}
                        {Array.isArray(b.counterHistory) && b.counterHistory.length > 0 && (
                          <details className="mt-1 max-w-[14rem] text-left">
                            <summary className="cursor-pointer text-[10px] text-slate-500">
                              Counter history ({b.counterHistory.length})
                            </summary>
                            <ul className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                              {[...b.counterHistory].reverse().slice(0, 5).map((h, i) => (
                                <li key={`${h.requestedAt}-${i}`}>
                                  {money(h.suggestedAmount)} · {h.status}
                                  <span className="text-slate-400">
                                    {" "}
                                    · {new Date(h.requestedAt).toLocaleString()}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {b.counterOffer?.status === "addressed" &&
                          b.quoteAmount != null &&
                          Math.abs(Number(b.quoteAmount) - Number(b.counterOffer.suggestedAmount)) >= 1 && (
                            <p className="mt-1 max-w-[12rem] text-[10px] text-amber-800">
                              Soft escrow preview: hold {money(b.quoteAmount)} (counter was{" "}
                              {money(b.counterOffer.suggestedAmount)})
                            </p>
                          )}
                      </div>
                    </div>
                    {(b.status === "active" || b.status === "accepted") && (() => {
                      const custom = whatIfCustom[b.id];
                      const customN = custom != null && custom !== "" ? Number(custom) : NaN;
                      const api = whatIfByBid[b.id];
                      const defaultHold = escrowHoldAmount(b);
                      const hold =
                        Number.isFinite(customN) && customN > 0
                          ? customN
                          : api?.amount ?? defaultHold;
                      const split =
                        api && Math.abs(Number(api.amount) - hold) < 0.02
                          ? { amount: api.amount, milestones: api.milestones }
                          : previewEscrowSplit(hold);
                      if (!(hold > 0) || split.milestones.length !== 3) return null;
                      return (
                        <div className="mt-3 rounded-xl bg-emerald-50/60 p-3 ring-1 ring-emerald-100">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-emerald-950">
                              Escrow what-if{" "}
                              <span className="font-normal text-emerald-800/80">
                                (simulated · {money(hold)})
                              </span>
                            </p>
                            {job.status === "open" && b.status === "active" && (
                              <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <span>Try ₹</span>
                                <input
                                  className="input h-7 w-24 py-0 text-xs"
                                  type="number"
                                  min={1}
                                  placeholder={String(Math.round(defaultHold))}
                                  value={whatIfCustom[b.id] ?? ""}
                                  onChange={(e) =>
                                    setWhatIfCustom((prev) => ({
                                      ...prev,
                                      [b.id]: e.target.value,
                                    }))
                                  }
                                />
                              </label>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {split.milestones.map((m) => (
                              <div
                                key={m.label}
                                className="rounded-lg bg-white/80 px-2 py-1.5 text-center ring-1 ring-emerald-100"
                              >
                                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                  {m.label}
                                </p>
                                <p className="text-sm font-bold text-slate-900">{money(m.amount)}</p>
                                <p className="text-[10px] text-slate-400">{m.percent}%</p>
                              </div>
                            ))}
                          </div>
                          {api?.note && (
                            <p className="mt-1.5 text-[10px] text-slate-500">{api.note}</p>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const points = (counterNegotiationSpark || []).filter((p) => p.bidId === b.id);
                      if (!points || points.length < 2) return null;
                      return (
                        <div className="mt-3 rounded-xl bg-violet-50/50 p-2.5 ring-1 ring-violet-100">
                          <p className="text-[11px] font-semibold text-slate-800">
                            This bid · counter sparkline
                          </p>
                          <CounterAmountSparkline points={points} />
                        </div>
                      );
                    })()}
                    {counterBidId === b.id && job.status === "open" && b.status === "active" && (
                      <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                        <p className="text-xs font-semibold text-slate-800">
                          Counter-offer / request revise
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Suggest an amount and notes. The pro is notified (simulated).
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(() => {
                            const base =
                              b.quoteAmount != null && Number(b.quoteAmount) > 0
                                ? Number(b.quoteAmount)
                                : Number(b.amount);
                            if (!Number.isFinite(base) || base <= 0) return null;
                            const presets = [
                              { label: "−10%", value: Math.max(1, Math.round(base * 0.9)) },
                              { label: "−15%", value: Math.max(1, Math.round(base * 0.85)) },
                              { label: "−20%", value: Math.max(1, Math.round(base * 0.8)) },
                            ];
                            return presets.map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                className="btn-ghost btn-sm text-[11px]"
                                onClick={() => setCounterAmount(String(p.value))}
                              >
                                Suggested {p.label} · ₹{p.value}
                              </button>
                            ));
                          })()}
                          {peerBestValueCounterHint && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm text-[11px] text-sky-800 ring-1 ring-sky-200"
                              title={`Soft hint from peer best-value hold (avg peers ₹${peerBestValueCounterHint.avgHold})`}
                              onClick={() =>
                                setCounterAmount(String(peerBestValueCounterHint.suggested))
                              }
                            >
                              Peer best-value · ₹{peerBestValueCounterHint.suggested}
                              {peerBestValueCounterHint.isBestPeer
                                ? ` (${peerBestValueCounterHint.peerName})`
                                : ""}
                            </button>
                          )}
                        </div>
                        {peerBestValueCounterHint && (
                          <p className="mt-1.5 text-[10px] text-sky-800/80">
                            Soft hint from clean peer best-value holds
                            {peerBestValueCounterHint.isBestPeer
                              ? ` — ${peerBestValueCounterHint.peerName}`
                              : ""}{" "}
                            (avg top peers ₹{peerBestValueCounterHint.avgHold}). Simulated only.
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(hoNoteTemplates.length ? hoNoteTemplates : DEFAULT_HOMEOWNER_COUNTER_NOTES).map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              className="btn-ghost btn-sm text-[11px]"
                              title={tpl.body}
                              onClick={() => setCounterNotes(tpl.body)}
                            >
                              {tpl.label}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            className="input w-36"
                            type="number"
                            min={1}
                            placeholder="Suggested ₹"
                            value={counterAmount}
                            onChange={(e) => setCounterAmount(e.target.value)}
                          />
                          <input
                            className="input min-w-[180px] flex-1"
                            placeholder="Notes (optional)"
                            value={counterNotes}
                            onChange={(e) => setCounterNotes(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={counterBusy}
                            onClick={() => onCounterOffer(b.id)}
                          >
                            {counterBusy ? "Sending…" : "Send to pro"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setCounterBidId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {job.status === "completed" && (
            <ReviewPanel jobId={job.id} review={review} proReview={proReview} onSaved={load} />
          )}

          {canMessage && (
            <JobConversations
              jobId={job.id}
              initialProId={searchParams.get("chat") || undefined}
              hiredProId={bids.find((b) => b.id === job.acceptedBidId)?.tradespersonId}
            />
          )}
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900">Job summary</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <Badge status={job.status} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Payment</dt>
                <dd>
                  <Badge status={job.paymentStatus || "pending"} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium">{categoryLabel(job.category)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Bids</dt>
                <dd className="font-medium">
                  {bids.filter((b) => b.status === "active" || b.status === "accepted").length}
                </dd>
              </div>
              {job.completedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Completed</dt>
                  <dd className="font-medium">{fmtDate(job.completedAt)}</dd>
                </div>
              )}
            </dl>
          </div>
          {job.acceptedBidId && (
            <ReportButton
              targetType="user"
              targetId={bids.find((b) => b.id === job.acceptedBidId)?.tradespersonId}
              label="Report this professional"
            />
          )}
        </aside>
      </div>
    
      {scorePro && (
        <MatchScorePanel
          open={!!scorePro}
          onClose={() => setScorePro(null)}
          name={scorePro.name}
          score={scorePro.score}
          breakdown={scorePro.breakdown}
        />
      )}
      <BestValueExplainPanel
        open={!!bestValueExplain}
        onClose={() => setBestValueExplain(null)}
        row={bestValueExplain}
      />
    </Shell>
  );
}
