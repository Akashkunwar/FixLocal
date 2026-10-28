import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { SITE, setPageMeta } from "../lib/site";
import { currentLang, LanguageToggle, t } from "../lib/i18n";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath } from "../api/client";

function PublicPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  useEffect(() => setPageMeta(t(title), description), [title, description]);
  const hi = currentLang() === "hi";
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold text-brand-800 no-underline">
            <Wrench className="h-5 w-5" aria-hidden /> {SITE.name}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            {user ? (
              <Link to={dashboardPath(user.role)} className="text-sm text-slate-600">{t("Dashboard")}</Link>
            ) : (
              <Link to="/login" className="text-sm text-slate-600">{t("Log in")}</Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {/* Legal text is English-only (the English version is the binding one); headings are translated. */}
        <article lang={hi ? "en-IN" : undefined} className="legal card space-y-4 p-6 text-[15px] leading-relaxed text-slate-700 sm:p-8">
          <h1 lang={hi ? "hi" : undefined} className="font-display text-3xl font-semibold text-slate-900">
            {t(title)}
          </h1>
          <p lang={hi ? "hi" : undefined} className="text-sm text-slate-500">
            {t("Last updated")} {SITE.legalUpdated}
          </p>
          {hi && (
            <p lang="hi" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              {t("This legal text is available in English only. The English version is the one that applies; headings are shown in Hindi to help you find your way.")}
            </p>
          )}
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => (
  <h2 lang={currentLang() === "hi" ? "hi" : undefined} className="pt-2 text-lg font-semibold text-slate-900">
    {children}
  </h2>
);
const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;

export function TermsPage() {
  return (
    <PublicPage title="Terms of Service" description="The rules for using FixLocal to post work and hire local professionals.">
      <p>
        These terms are an agreement between you and {SITE.operator} (“{SITE.name}”, “we”). By creating an account you
        accept them and our <Link to="/privacy">Privacy Policy</Link>.
      </p>
      <H>{t("1. What FixLocal is")}</H>
      <p>
        {SITE.name} is an online marketplace that connects people who need work done (“clients”) with independent local
        professionals (“pros”). Pros are not our employees or agents. The contract for each job is between the client and
        the pro; we provide the platform, verification checks, messaging, a payment flow and dispute handling.
      </p>
      <H>{t("2. Accounts")}</H>
      <UL>
        <li>You must be at least 18 and give accurate details. One person, one account.</li>
        <li>Keep your password secret; you are responsible for activity on your account.</li>
        <li>Pros must pass our document check before bidding. Verification is a check, not a guarantee of quality.</li>
      </UL>
      <H>{t("3. Payments and escrow")}</H>
      <p>
        <strong>During the pilot, payments on {SITE.name} are simulated: no real money is charged, held or paid out.</strong>{" "}
        When real payments are switched on we will update these terms and ask you to accept them again. The flow is: when a
        client hires a pro the agreed price is held in three milestones (Deposit 30%, Progress 40%, Completion 30%); each
        is released as the work progresses, and the rest when the client confirms completion or after the automatic
        confirmation period.
      </p>
      <H>{t("4. Cancellations and refunds")}</H>
      <UL>
        <li>A client can cancel an open job at any time; open bids are closed.</li>
        <li>
          Before work starts, either the client or the hired pro can call off the booking. Every milestone still held is
          refunded to the client. A deposit the client already released stays with the pro.
        </li>
        <li>Once work has started, problems are handled through a dispute, which an admin reviews.</li>
        <li>Released money is not clawed back except through a dispute decision.</li>
      </UL>
      <H>{t("5. Disputes")}</H>
      <p>
        Either party can open a dispute while work is live or after completion. Payments freeze until an admin decides,
        which may mean releasing, refunding or splitting the held amounts. Decisions are recorded in an audit log.
      </p>
      <H>{t("6. Acceptable use")}</H>
      <UL>
        <li>No fake jobs, fake bids, spam, harassment, discrimination or illegal work.</li>
        <li>Don’t move a job off-platform to avoid fees or protections, and don’t share others’ personal data.</li>
        <li>Reviews must be honest and about a real job.</li>
        <li>You can report or block any user. We may remove content, suspend or close accounts that break these rules.</li>
      </UL>
      <H>{t("7. Content you post")}</H>
      <p>
        You keep ownership of photos and text you upload and give us a licence to host and show them for running the
        service. Completion photos appear on a pro’s public portfolio only with the client’s consent.
      </p>
      <H>{t("8. Liability")}</H>
      <p>
        The work is performed by the pro, who is responsible for it. To the extent the law allows, {SITE.name} is not
        liable for the quality, safety or legality of the work, and our total liability for any claim is limited to the
        fees we received for the job concerned. Nothing here limits rights you have under the Consumer Protection Act, 2019.
      </p>
      <H>{t("9. Closing your account")}</H>
      <p>
        You can download your data or delete your account from Settings at any time (not while a job is in progress).
      </p>
      <H>{t("10. Grievances and contact")}</H>
      <p>
        Grievance Officer: {SITE.grievanceOfficer}, <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a>.
        We acknowledge complaints within 24 hours and resolve them within 15 days. General support:{" "}
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
      <H>{t("11. Law")}</H>
      <p>These terms are governed by the laws of India. Courts at the operator’s registered office have jurisdiction.</p>
    </PublicPage>
  );
}

export function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy" description="What personal data FixLocal collects, why, and the choices you have.">
      <p>
        This policy explains how {SITE.operator} handles personal data, in line with the Digital Personal Data Protection
        Act, 2023 and the Information Technology Act, 2000.
      </p>
      <H>{t("What we collect")}</H>
      <UL>
        <li>Account: name, email, phone (optional), password (stored only as a hash), role, time zone.</li>
        <li>Jobs and bids: descriptions, photos, budget, location (area, pincode and an optional map pin), quotes.</li>
        <li>Pros: skills, service areas, portfolio, availability and the licence or ID document you upload for verification.</li>
        <li>Activity: messages, reviews, disputes, reports, notifications and the (simulated) payment ledger.</li>
        <li>Technical: IP address and device information in security logs; a sign-in cookie.</li>
      </UL>
      <H>{t("Why we use it")}</H>
      <UL>
        <li>To run the marketplace: match jobs and pros, show bids, enable chat, track work and payments.</li>
        <li>To keep it safe: verification, fraud and abuse prevention, rate limiting, dispute resolution.</li>
        <li>To contact you about your account and jobs (you can switch off non-essential emails in Settings).</li>
      </UL>
      <p>We don’t sell personal data and don’t use it for third-party advertising.</p>
      <H>{t("Who can see what")}</H>
      <UL>
        <li>Pros see a job’s area and pincode; the exact address is shared only with the pro you hire.</li>
        <li>Clients see a pro’s public profile, reviews and portfolio. Email addresses are never shown to other users.</li>
        <li>Verification documents are visible only to the pro and our admins.</li>
        <li>Service providers who host the service or send email process data on our behalf under contract.</li>
      </UL>
      <H>{t("Cookies")}</H>
      <p>
        We use one essential, http-only cookie to keep you signed in, and your browser’s local storage for drafts and
        interface preferences. We don’t use advertising or tracking cookies, so there is nothing to opt out of.
      </p>
      <H>{t("How long we keep it")}</H>
      <p>
        While your account is open. When you delete it we remove your profile, contact details, photos and templates;
        finished jobs, reviews and payment records stay without your name where we need them for the other party, for
        disputes or for legal and tax obligations.
      </p>
      <H>{t("Your rights")}</H>
      <UL>
        <li>Access: download a copy of your data from Settings → Your data.</li>
        <li>Correction: edit your profile at any time.</li>
        <li>Erasure: delete your account from Settings.</li>
        <li>Grievance: contact our Grievance Officer below. You may also approach the Data Protection Board of India.</li>
      </UL>
      <H>{t("Security")}</H>
      <p>
        Passwords are hashed, sessions expire, uploads are checked and re-encoded, private files are served through signed
        links, and access to every job is checked on the server.
      </p>
      <H>{t("Contact")}</H>
      <p>
        Grievance Officer: {SITE.grievanceOfficer}, <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a>.
        Support: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
    </PublicPage>
  );
}

export function NotFoundPage() {
  useEffect(() => setPageMeta(t("Page not found")), []);
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-6xl font-semibold text-brand-700">404</p>
        <h1 className="mt-3 text-xl font-semibold text-slate-900">{t("We couldn’t find that page")}</h1>
        <p className="mt-2 text-sm text-slate-600">{t("The link may be old, or the page may have moved.")}</p>
        <Link to="/" className="btn-primary mt-6 no-underline">{t("Go to FixLocal")}</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
