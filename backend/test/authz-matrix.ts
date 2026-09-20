/**
 * Expected HTTP status for (action × job state × actor).
 * Keep this table readable: it is the specification the authz tests enforce.
 */
export const STATES = ["open", "awarded", "in_progress", "pending_confirmation", "completed", "cancelled", "disputed"] as const;
export type State = (typeof STATES)[number];

export const ACTORS = ["anon", "admin", "owner", "otherClient", "awardedPro", "bidder", "strangerPro", "pendingPro"] as const;
export type Actor = (typeof ACTORS)[number];

export type Action = {
  name: string;
  method: "get" | "post" | "patch";
  path: (jobId: string, ids: { bidderId: string; awardedProId: string | null }, actor: Actor) => string;
  body?: Record<string, unknown>;
  mutates: boolean;
  expect: (state: State, actor: Actor) => number;
};

type Real = Exclude<Actor, "anon">;

const nonOpen = (s: State) => s !== "open";
const liveWork = (s: State) => ["awarded", "in_progress", "pending_confirmation"].includes(s);

/**
 * Wraps a rule: anonymous callers always get 401, and before an award
 * the "awardedPro" actor is simply another verified pro without a bid.
 */
function rule(fn: (s: State, a: Real) => number) {
  return (s: State, actor: Actor) => {
    if (actor === "anon") return 401;
    const a: Real = s === "open" && actor === "awardedPro" ? "strangerPro" : actor;
    return fn(s, a);
  };
}

const table = (s: State, entries: Record<Real, number>) => (a: Real) => entries[a];

export const ACTIONS: Action[] = [
  {
    name: "view job",
    method: "get",
    path: (id) => `/api/jobs/${id}`,
    mutates: false,
    expect: rule((s, a) =>
      table(s, {
        admin: 200,
        owner: 200,
        otherClient: 403,
        awardedPro: 200,
        bidder: 200,
        strangerPro: s === "open" ? 200 : 403,
        pendingPro: 403,
      })(a)
    ),
  },
  {
    name: "view bids",
    method: "get",
    path: (id) => `/api/jobs/${id}/bids`,
    mutates: false,
    expect: rule((s, a) =>
      table(s, {
        admin: 200,
        owner: 200,
        otherClient: 403,
        awardedPro: 200,
        bidder: 200,
        strangerPro: 403,
        pendingPro: 403,
      })(a)
    ),
  },
  {
    name: "view payments",
    method: "get",
    path: (id) => `/api/jobs/${id}/payments`,
    mutates: false,
    expect: rule((_s, a) => (a === "admin" || a === "owner" || a === "awardedPro" ? 200 : 403)),
  },
  {
    name: "view schedule",
    method: "get",
    path: (id) => `/api/jobs/${id}/schedule`,
    mutates: false,
    expect: rule((s, a) =>
      table(s, {
        admin: 200,
        owner: 200,
        otherClient: 403,
        awardedPro: 200,
        bidder: 200,
        strangerPro: s === "open" ? 200 : 403,
        pendingPro: 403,
      })(a)
    ),
  },
  {
    name: "read job reviews",
    method: "get",
    path: (id) => `/api/reviews/job/${id}`,
    mutates: false,
    expect: rule((_s, a) => (a === "admin" || a === "owner" || a === "awardedPro" ? 200 : 403)),
  },
  {
    name: "list invites",
    method: "get",
    path: (id) => `/api/jobs/${id}/invites`,
    mutates: false,
    expect: rule((_s, a) => (a === "admin" || a === "owner" ? 200 : 403)),
  },
  {
    name: "suggested pros",
    method: "get",
    path: (id) => `/api/jobs/${id}/suggested-pros`,
    mutates: false,
    expect: rule((_s, a) => (a === "admin" || a === "owner" ? 200 : 403)),
  },
  {
    name: "read chat thread",
    method: "get",
    path: (id, ids, actor) => {
      const pro = ids.awardedProId ?? ids.bidderId;
      return actor === "owner" || actor === "admin" || actor === "otherClient"
        ? `/api/messages/${id}?pro=${pro}`
        : `/api/messages/${id}`;
    },
    mutates: false,
    expect: rule((s, a) =>
      table(s, {
        admin: 200,
        owner: 200,
        otherClient: 403,
        awardedPro: 200,
        bidder: s === "open" ? 200 : 403,
        strangerPro: 403,
        pendingPro: 403,
      })(a)
    ),
  },
  {
    name: "edit job",
    method: "patch",
    path: (id) => `/api/jobs/${id}`,
    body: { title: "Edited by matrix" },
    mutates: true,
    expect: rule((s, a) => (a === "owner" ? (s === "open" ? 200 : 409) : 403)),
  },
  {
    name: "cancel job",
    method: "post",
    path: (id) => `/api/jobs/${id}/cancel`,
    mutates: true,
    expect: rule((s, a) => (a === "owner" ? (s === "open" ? 200 : 409) : 403)),
  },
  {
    name: "place bid",
    method: "post",
    path: (id) => `/api/jobs/${id}/bids`,
    body: { amount: 321 },
    mutates: true,
    expect: rule((s, a) => {
      if (a === "strangerPro") return s === "open" ? 201 : 409;
      if (a === "bidder" || a === "awardedPro") return 409;
      return 403;
    }),
  },
  {
    name: "start work",
    method: "post",
    path: (id) => `/api/jobs/${id}/start`,
    mutates: true,
    expect: rule((s, a) => (a === "awardedPro" ? (s === "awarded" ? 200 : 409) : 403)),
  },
  {
    name: "mark done",
    method: "post",
    path: (id) => `/api/jobs/${id}/mark-done`,
    mutates: true,
    expect: rule((s, a) => (a === "awardedPro" ? (s === "in_progress" ? 200 : 409) : 403)),
  },
  {
    name: "confirm completion",
    method: "post",
    path: (id) => `/api/jobs/${id}/confirm`,
    mutates: true,
    expect: rule((s, a) => (a === "owner" || a === "admin" ? (liveWork(s) ? 200 : 409) : 403)),
  },
  {
    name: "open dispute",
    method: "post",
    path: (id) => `/api/jobs/${id}/disputes`,
    body: { reason: "Matrix dispute" },
    mutates: true,
    expect: rule((s, a) => {
      const party = a === "owner" || (a === "awardedPro" && nonOpen(s));
      if (!party) return 403;
      return liveWork(s) || s === "completed" ? 201 : 409;
    }),
  },
];
