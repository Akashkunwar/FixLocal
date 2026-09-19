import type { Job, JobPayments } from "../api/jobs";
import { money, fmtDate, fmtDateTime } from "./format";

export function buildMilestoneInvoiceHtml(job: Job, payments: JobPayments): string {
  const rows = payments.milestones
    .map(
      (m) => `
      <tr class="status-${escapeHtml(m.status)}">
        <td>${m.sequence}. ${escapeHtml(m.label)} (${m.percent}%)</td>
        <td class="num">${money(m.amount)}</td>
        <td><span class="pill ${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></td>
        <td>${m.releasedAt ? fmtDate(m.releasedAt) : "—"}</td>
      </tr>`
    )
    .join("");

  const home = payments.parties?.homeowner;
  const pro = payments.parties?.tradesperson;
  const partiesBlock = `
  <div class="parties">
    <div class="party">
      <h2>Bill from (client)</h2>
      <p class="name">${escapeHtml(home?.name || "—")}</p>
      <p class="muted">${escapeHtml(home?.email || job.homeownerId)}</p>
    </div>
    <div class="party">
      <h2>Pay to (professional)</h2>
      <p class="name">${escapeHtml(pro?.name || "—")}</p>
      <p class="muted">${escapeHtml(pro?.email || (pro?.id ? pro.id : "Not awarded yet"))}</p>
    </div>
  </div>`;

  const audit = payments.auditNotes || [];
  const auditBlock = audit.length
    ? `<div class="audit">
        <h2>Audit notes</h2>
        <ul>
          ${audit
            .map(
              (a) => `<li>
            <strong>${escapeHtml(a.summary || a.action)}</strong>
            <span class="muted"> · ${fmtDateTime(a.createdAt)}${
                a.actorEmail ? ` · ${escapeHtml(a.actorEmail)}` : ""
              }</span>
            ${
              a.snippet
                ? `<div class="snippet">${escapeHtml(a.snippet)}</div>`
                : ""
            }
          </li>`
            )
            .join("")}
        </ul>
      </div>`
    : "";

  const sourceLabel =
    payments.escrowSource === "quote"
      ? "structured quote"
      : payments.escrowSource === "bid"
        ? "bid amount"
        : null;

  const invNo = `FL-${job.id.slice(0, 8).toUpperCase()}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>FixLocal escrow invoice — ${escapeHtml(job.title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; max-width: 740px; margin: 1.5rem auto; padding: 0 1.25rem 2rem; line-height: 1.45; }
    .sheet { border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.5rem 1.5rem 1.25rem; background: #fff; }
    .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 2px solid #0f172a; }
    .brand .logo { font-weight: 800; font-size: 1.25rem; letter-spacing: -0.02em; }
    .brand .meta { text-align: right; font-size: 0.8rem; color: #64748b; }
    h1 { font-size: 1.2rem; margin: 0 0 0.35rem; }
    h2 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 0.35rem; font-weight: 700; }
    .muted { color: #64748b; font-size: 0.875rem; }
    .name { margin: 0; font-weight: 600; font-size: 0.95rem; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.1rem; }
    .party { padding: 0.85rem 1rem; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; }
    .party p { margin: 0.15rem 0 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 1.35rem; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 0.65rem 0.45rem; font-size: 0.9rem; text-align: left; }
    th { color: #64748b; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .pill { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 999px; font-size: 0.7rem; text-transform: capitalize; background: #f1f5f9; }
    .pill.released { background: #dcfce7; color: #166534; }
    .pill.held, .pill.pending { background: #fef3c7; color: #92400e; }
    .pill.refunded { background: #ffe4e6; color: #9f1239; }
    .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; background: #f1f5f9; font-size: 0.75rem; text-transform: capitalize; }
    .totals { margin-top: 1.25rem; display: grid; gap: 0.4rem; padding: 1rem; background: #0f172a; color: #f8fafc; border-radius: 12px; }
    .totals strong { font-size: 1.05rem; }
    .totals .row { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.9rem; }
    .totals .row.grand { font-size: 1.05rem; padding-top: 0.35rem; border-top: 1px solid #334155; margin-top: 0.25rem; }
    .audit { margin-top: 1.5rem; padding: 1rem; border: 1px dashed #cbd5e1; border-radius: 12px; break-inside: avoid; }
    .audit ul { margin: 0; padding-left: 1.1rem; }
    .audit li { margin: 0.45rem 0; font-size: 0.875rem; }
    .snippet { margin-top: 0.2rem; color: #475569; font-size: 0.8rem; white-space: pre-wrap; }
    .footer { margin-top: 1.75rem; padding-top: 0.75rem; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #64748b; }
    .toolbar { margin-bottom: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .toolbar button { appearance: none; border: 0; background: #0f172a; color: #fff; padding: 0.55rem 0.9rem; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 0.875rem; }
    .toolbar .hint { font-size: 0.8rem; color: #64748b; }
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; padding: 0; max-width: none; }
      .sheet { border: 0; border-radius: 0; padding: 0; }
      .totals { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .pill, .badge, .party { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 14mm; size: A4; }
      tr { break-inside: avoid; }
      .audit, .totals, .parties { break-inside: avoid; }
    }
    @media (max-width: 560px) { .parties { grid-template-columns: 1fr; } .brand { flex-direction: column; } .brand .meta { text-align: left; } }
  </style>
</head>
<body>
  <p class="toolbar no-print">
    <button onclick="window.print()">Print / Save as PDF</button>
    <span class="hint">Use your browser’s “Save as PDF” printer for a clean invoice.</span>
  </p>
  <div class="sheet">
    <div class="brand">
      <div>
        <div class="logo">FixLocal</div>
        <h1>Simulated escrow invoice</h1>
        <p class="muted">Demo only — not a tax invoice</p>
      </div>
      <div class="meta">
        <div><strong>Invoice</strong> ${escapeHtml(invNo)}</div>
        <div>Generated ${fmtDateTime(new Date().toISOString())}</div>
        <div>Job ${escapeHtml(job.id.slice(0, 8))}…</div>
      </div>
    </div>
    <p><strong>${escapeHtml(job.title)}</strong><br/>
    ${job.city || job.area ? `Location: ${escapeHtml([job.area, job.city].filter(Boolean).join(", "))}<br/>` : ""}
    Status: <span class="badge">${escapeHtml(job.status)}</span>
    · Payment: <span class="badge">${escapeHtml(payments.paymentStatus)}</span>
    ${
      sourceLabel
        ? `· Escrow source: <span class="badge">${escapeHtml(sourceLabel)}</span>`
        : ""
    }</p>
    ${partiesBlock}
    <table>
      <thead>
        <tr><th>Milestone</th><th class="num">Amount</th><th>Status</th><th>Released</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Escrow total</span><strong>${money(payments.escrowAmount)}</strong></div>
      <div class="row"><span>Released</span><strong>${money(payments.releasedTotal)}</strong></div>
      <div class="row grand"><span>Still held</span><strong>${money(payments.remainingHeld)}</strong></div>
      ${
        sourceLabel
          ? `<div class="row"><span>Source</span><span>${escapeHtml(sourceLabel)} (simulated)</span></div>`
          : ""
      }
    </div>
    ${auditBlock}
    <p class="footer">Payments on FixLocal are simulated for coursework. No real funds move. Print this page to PDF for your records.</p>
  </div>
</body>
</html>`;
}

export function downloadMilestoneInvoice(job: Job, payments: JobPayments) {
  const html = buildMilestoneInvoiceHtml(job, payments);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fixlocal-escrow-${job.id.slice(0, 8)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download asynchronously; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Opens the invoice in a new window and starts printing.
 * `noopener` would make window.open return null, so the opener link is cut by hand instead.
 * Falls back to a download when pop-ups are blocked.
 */
export function printMilestoneInvoice(job: Job, payments: JobPayments): "printed" | "downloaded" {
  const html = buildMilestoneInvoiceHtml(job, payments);
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    downloadMilestoneInvoice(job, payments);
    return "downloaded";
  }
  w.opener = null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return "printed";
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
