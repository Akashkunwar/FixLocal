import { Suspense, lazy, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuth } from "./auth/AuthContext";
import { dashboardPath, type Role } from "./api/client";
import { Spinner } from "./components/ui/Spinner";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { CLIENT_ROOT, LEGACY_CLIENT_ROOT, LEGACY_PRO_ROOT, PRO_ROOT } from "./lib/paths";
import { useI18n } from "./lib/i18n";
import { Keyed } from "./components/Keyed";

import { SkipLink } from "./components/SkipLink";
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const RegisterPage = page(() => import("./pages/RegisterPage"), "RegisterPage");
const LeadGroupHubPage = page(() => import("./pages/LeadGroupHubPage"), "LeadGroupHubPage");
const ForgotPasswordPage = page(() => import("./pages/AccountPages"), "ForgotPasswordPage");
const ResetPasswordPage = page(() => import("./pages/AccountPages"), "ResetPasswordPage");
const VerifyEmailPage = page(() => import("./pages/AccountPages"), "VerifyEmailPage");
const SettingsPage = page(() => import("./pages/SettingsPage"), "SettingsPage");
const TermsPage = page(() => import("./pages/LegalPages"), "TermsPage");
const PrivacyPage = page(() => import("./pages/LegalPages"), "PrivacyPage");
const NotFoundPage = page(() => import("./pages/LegalPages"), "NotFoundPage");
const FavoritesPage = page(() => import("./pages/FavoritesPage"), "FavoritesPage");
const ProPublicPage = page(() => import("./pages/ProPublicPage"), "ProPublicPage");
const AdminStatsPage = page(() => import("./pages/admin/AdminStatsPage"), "AdminStatsPage");
const AdminTradespeoplePage = page(() => import("./pages/admin/AdminTradespeoplePage"), "AdminTradespeoplePage");
const AdminUsersPage = page(() => import("./pages/admin/AdminUsersPage"), "AdminUsersPage");
const AdminDisputesPage = page(() => import("./pages/admin/AdminDisputesPage"), "AdminDisputesPage");
const AdminReportsPage = page(() => import("./pages/admin/AdminReportsPage"), "AdminReportsPage");
const AdminJobsPage = page(() => import("./pages/admin/AdminJobsPage"), "AdminJobsPage");
const AdminAuditPage = page(() => import("./pages/admin/AdminAuditPage"), "AdminAuditPage");
const AdminMatchPage = page(() => import("./pages/admin/AdminMatchPage"), "AdminMatchPage");
const HomeownerDashboard = page(() => import("./pages/homeowner/HomeownerDashboard"), "HomeownerDashboard");
const CreateJobPage = page(() => import("./pages/homeowner/CreateJobPage"), "CreateJobPage");
const JobDetailPage = page(() => import("./pages/homeowner/JobDetailPage"), "JobDetailPage");
const FindProsPage = page(() => import("./pages/homeowner/FindProsPage"), "FindProsPage");
const BrowseJobsPage = page(() => import("./pages/tradesperson/BrowseJobsPage"), "BrowseJobsPage");
const ProJobDetailPage = page(() => import("./pages/tradesperson/ProJobDetailPage"), "ProJobDetailPage");
const MyJobsPage = page(() => import("./pages/tradesperson/MyJobsPage"), "MyJobsPage");
const ProfilePage = page(() => import("./pages/tradesperson/ProfilePage"), "ProfilePage");
const AnalyticsPage = page(() => import("./pages/tradesperson/AnalyticsPage"), "AnalyticsPage");
const NotificationsPage = page(() => import("./pages/NotificationsPage"), "NotificationsPage");
const SpendingPage = page(() => import("./pages/homeowner/SpendingPage"), "SpendingPage");
const JobAlertsPage = page(() => import("./pages/tradesperson/JobAlertsPage"), "JobAlertsPage");

const ANY: Role[] = ["ADMIN", "HOMEOWNER", "TRADESPERSON"];

/** Routes are built per render (not module constants) so a language switch re-renders every page. */
const PROTECTED: { path: string; allow: Role[]; Page: ComponentType; keyBy?: string }[] = [
  { path: "/notifications", allow: ANY, Page: NotificationsPage },
  { path: "/settings", allow: ANY, Page: SettingsPage },
  { path: "/admin", allow: ["ADMIN"], Page: AdminStatsPage },
  { path: "/admin/users", allow: ["ADMIN"], Page: AdminUsersPage },
  { path: "/admin/tradespeople", allow: ["ADMIN"], Page: AdminTradespeoplePage },
  { path: "/admin/disputes", allow: ["ADMIN"], Page: AdminDisputesPage },
  { path: "/admin/reports", allow: ["ADMIN"], Page: AdminReportsPage },
  { path: "/admin/jobs", allow: ["ADMIN"], Page: AdminJobsPage },
  { path: "/admin/audit", allow: ["ADMIN"], Page: AdminAuditPage },
  { path: "/admin/match", allow: ["ADMIN"], Page: AdminMatchPage },
  { path: CLIENT_ROOT, allow: ["HOMEOWNER"], Page: HomeownerDashboard },
  { path: `${CLIENT_ROOT}/jobs/new`, allow: ["HOMEOWNER"], Page: CreateJobPage },
  { path: `${CLIENT_ROOT}/jobs/:id`, allow: ["HOMEOWNER"], Page: JobDetailPage, keyBy: "id" },
  { path: `${CLIENT_ROOT}/pros`, allow: ["HOMEOWNER"], Page: FindProsPage },
  { path: `${CLIENT_ROOT}/spending`, allow: ["HOMEOWNER"], Page: SpendingPage },
  { path: `${CLIENT_ROOT}/favorites`, allow: ["HOMEOWNER"], Page: FavoritesPage },
  { path: PRO_ROOT, allow: ["TRADESPERSON"], Page: BrowseJobsPage },
  { path: `${PRO_ROOT}/jobs/:id`, allow: ["TRADESPERSON"], Page: ProJobDetailPage, keyBy: "id" },
  { path: `${PRO_ROOT}/my-jobs`, allow: ["TRADESPERSON"], Page: MyJobsPage },
  { path: `${PRO_ROOT}/profile`, allow: ["TRADESPERSON"], Page: ProfilePage },
  { path: `${PRO_ROOT}/analytics`, allow: ["TRADESPERSON"], Page: AnalyticsPage },
  { path: `${PRO_ROOT}/alerts`, allow: ["TRADESPERSON"], Page: JobAlertsPage },
  { path: `${PRO_ROOT}/favorites`, allow: ["TRADESPERSON"], Page: FavoritesPage },
];

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner />
    </div>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <LandingPage />;
  return <Navigate to={dashboardPath(user.role)} replace />;
}

/** Old bookmarks (/homeowner/..., /tradesperson/...) keep working but land on the canonical URL. */
function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  const rest = location.pathname.slice(from.length);
  return <Navigate to={`${to}${rest}${location.search}${location.hash}`} replace />;
}

export default function App() {
  const location = useLocation();
  useI18n(); // re-render the route tree (not remount it) when the language changes
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <SkipLink />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/categories/:groupSlug" element={<LeadGroupHubPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* Public so profiles can be shared and indexed; contact details stay hidden server-side. */}
          <Route path="/pros/:userId" element={<Keyed param="userId"><ProPublicPage /></Keyed>} />
          {PROTECTED.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={
                <ProtectedRoute allow={r.allow}>
                  {r.keyBy ? (
                    <Keyed param={r.keyBy}>
                      <r.Page />
                    </Keyed>
                  ) : (
                    <r.Page />
                  )}
                </ProtectedRoute>
              }
            />
          ))}
          <Route path={`${LEGACY_CLIENT_ROOT}/*`} element={<LegacyRedirect from={LEGACY_CLIENT_ROOT} to={CLIENT_ROOT} />} />
          <Route path={`${LEGACY_PRO_ROOT}/*`} element={<LegacyRedirect from={LEGACY_PRO_ROOT} to={PRO_ROOT} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
