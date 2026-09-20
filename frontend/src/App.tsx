import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuth } from "./auth/AuthContext";
import { dashboardPath, type Role } from "./api/client";
import { Spinner } from "./components/ui/Spinner";
import { LandingPage } from "./pages/LandingPage";
import { LeadGroupHubPage } from "./pages/LeadGroupHubPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CLIENT_ROOT, LEGACY_CLIENT_ROOT, LEGACY_PRO_ROOT, PRO_ROOT } from "./lib/paths";

function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const ForgotPasswordPage = page(() => import("./pages/AccountPages"), "ForgotPasswordPage");
const ResetPasswordPage = page(() => import("./pages/AccountPages"), "ResetPasswordPage");
const VerifyEmailPage = page(() => import("./pages/AccountPages"), "VerifyEmailPage");
const SettingsPage = page(() => import("./pages/SettingsPage"), "SettingsPage");
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

const ANY: Role[] = ["ADMIN", "HOMEOWNER", "TRADESPERSON"];

const PROTECTED: { path: string; allow: Role[]; element: ReactNode }[] = [
  { path: "/settings", allow: ANY, element: <SettingsPage /> },
  { path: "/pros/:userId", allow: ANY, element: <ProPublicPage /> },
  { path: "/admin", allow: ["ADMIN"], element: <AdminStatsPage /> },
  { path: "/admin/users", allow: ["ADMIN"], element: <AdminUsersPage /> },
  { path: "/admin/tradespeople", allow: ["ADMIN"], element: <AdminTradespeoplePage /> },
  { path: "/admin/disputes", allow: ["ADMIN"], element: <AdminDisputesPage /> },
  { path: "/admin/reports", allow: ["ADMIN"], element: <AdminReportsPage /> },
  { path: "/admin/jobs", allow: ["ADMIN"], element: <AdminJobsPage /> },
  { path: "/admin/audit", allow: ["ADMIN"], element: <AdminAuditPage /> },
  { path: "/admin/match", allow: ["ADMIN"], element: <AdminMatchPage /> },
  { path: CLIENT_ROOT, allow: ["HOMEOWNER"], element: <HomeownerDashboard /> },
  { path: `${CLIENT_ROOT}/jobs/new`, allow: ["HOMEOWNER"], element: <CreateJobPage /> },
  { path: `${CLIENT_ROOT}/jobs/:id`, allow: ["HOMEOWNER"], element: <JobDetailPage /> },
  { path: `${CLIENT_ROOT}/pros`, allow: ["HOMEOWNER"], element: <FindProsPage /> },
  { path: `${CLIENT_ROOT}/favorites`, allow: ["HOMEOWNER"], element: <FavoritesPage /> },
  { path: PRO_ROOT, allow: ["TRADESPERSON"], element: <BrowseJobsPage /> },
  { path: `${PRO_ROOT}/jobs/:id`, allow: ["TRADESPERSON"], element: <ProJobDetailPage /> },
  { path: `${PRO_ROOT}/my-jobs`, allow: ["TRADESPERSON"], element: <MyJobsPage /> },
  { path: `${PRO_ROOT}/profile`, allow: ["TRADESPERSON"], element: <ProfilePage /> },
  { path: `${PRO_ROOT}/analytics`, allow: ["TRADESPERSON"], element: <AnalyticsPage /> },
  { path: `${PRO_ROOT}/favorites`, allow: ["TRADESPERSON"], element: <FavoritesPage /> },
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
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/categories/:groupSlug" element={<LeadGroupHubPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {PROTECTED.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={<ProtectedRoute allow={r.allow}>{r.element}</ProtectedRoute>}
            />
          ))}
          <Route path={`${LEGACY_CLIENT_ROOT}/*`} element={<LegacyRedirect from={LEGACY_CLIENT_ROOT} to={CLIENT_ROOT} />} />
          <Route path={`${LEGACY_PRO_ROOT}/*`} element={<LegacyRedirect from={LEGACY_PRO_ROOT} to={PRO_ROOT} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
