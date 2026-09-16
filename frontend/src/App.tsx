import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { dashboardPath } from "./api/client";
import { Spinner } from "./components/ui/Spinner";
import { LandingPage } from "./pages/LandingPage";
import { LeadGroupHubPage } from "./pages/LeadGroupHubPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CLIENT_PREFIXES, PRO_PREFIXES } from "./lib/paths";

const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const FavoritesPage = lazy(() =>
  import("./pages/FavoritesPage").then((m) => ({ default: m.FavoritesPage }))
);
const ProPublicPage = lazy(() =>
  import("./pages/ProPublicPage").then((m) => ({ default: m.ProPublicPage }))
);
const AdminStatsPage = lazy(() =>
  import("./pages/admin/AdminStatsPage").then((m) => ({ default: m.AdminStatsPage }))
);
const AdminTradespeoplePage = lazy(() =>
  import("./pages/admin/AdminTradespeoplePage").then((m) => ({
    default: m.AdminTradespeoplePage,
  }))
);
const AdminUsersPage = lazy(() =>
  import("./pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage }))
);
const AdminDisputesPage = lazy(() =>
  import("./pages/admin/AdminDisputesPage").then((m) => ({ default: m.AdminDisputesPage }))
);
const AdminJobsPage = lazy(() =>
  import("./pages/admin/AdminJobsPage").then((m) => ({ default: m.AdminJobsPage }))
);
const AdminAuditPage = lazy(() =>
  import("./pages/admin/AdminAuditPage").then((m) => ({ default: m.AdminAuditPage }))
);
const AdminMatchPage = lazy(() =>
  import("./pages/admin/AdminMatchPage").then((m) => ({ default: m.AdminMatchPage }))
);
const HomeownerDashboard = lazy(() =>
  import("./pages/homeowner/HomeownerDashboard").then((m) => ({
    default: m.HomeownerDashboard,
  }))
);
const CreateJobPage = lazy(() =>
  import("./pages/homeowner/CreateJobPage").then((m) => ({ default: m.CreateJobPage }))
);
const JobDetailPage = lazy(() =>
  import("./pages/homeowner/JobDetailPage").then((m) => ({ default: m.JobDetailPage }))
);
const FindProsPage = lazy(() =>
  import("./pages/homeowner/FindProsPage").then((m) => ({ default: m.FindProsPage }))
);
const BrowseJobsPage = lazy(() =>
  import("./pages/tradesperson/BrowseJobsPage").then((m) => ({ default: m.BrowseJobsPage }))
);
const ProJobDetailPage = lazy(() =>
  import("./pages/tradesperson/ProJobDetailPage").then((m) => ({
    default: m.ProJobDetailPage,
  }))
);
const MyJobsPage = lazy(() =>
  import("./pages/tradesperson/MyJobsPage").then((m) => ({ default: m.MyJobsPage }))
);
const ProfilePage = lazy(() =>
  import("./pages/tradesperson/ProfilePage").then((m) => ({ default: m.ProfilePage }))
);
const AnalyticsPage = lazy(() =>
  import("./pages/tradesperson/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage }))
);

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner />
    </div>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <LandingPage />;
  return <Navigate to={dashboardPath(user.role)} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/categories/:groupSlug" element={<LeadGroupHubPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/settings"
          element={
            <ProtectedRoute allow={["ADMIN", "HOMEOWNER", "TRADESPERSON"]}>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pros/:userId"
          element={
            <ProtectedRoute allow={["ADMIN", "HOMEOWNER", "TRADESPERSON"]}>
              <ProPublicPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminStatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tradespeople"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminTradespeoplePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/disputes"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminDisputesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/jobs"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminJobsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminAuditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/match"
          element={
            <ProtectedRoute allow={["ADMIN"]}>
              <AdminMatchPage />
            </ProtectedRoute>
          }
        />

        {CLIENT_PREFIXES.map((p) => (
          <Route
            key={`${p}-dash`}
            path={p}
            element={
              <ProtectedRoute allow={["HOMEOWNER"]}>
                <HomeownerDashboard />
              </ProtectedRoute>
            }
          />
        ))}
        {CLIENT_PREFIXES.map((p) => (
          <Route
            key={`${p}-new`}
            path={`${p}/jobs/new`}
            element={
              <ProtectedRoute allow={["HOMEOWNER"]}>
                <CreateJobPage />
              </ProtectedRoute>
            }
          />
        ))}
        {CLIENT_PREFIXES.map((p) => (
          <Route
            key={`${p}-job`}
            path={`${p}/jobs/:id`}
            element={
              <ProtectedRoute allow={["HOMEOWNER"]}>
                <JobDetailPage />
              </ProtectedRoute>
            }
          />
        ))}
        {CLIENT_PREFIXES.map((p) => (
          <Route
            key={`${p}-pros`}
            path={`${p}/pros`}
            element={
              <ProtectedRoute allow={["HOMEOWNER"]}>
                <FindProsPage />
              </ProtectedRoute>
            }
          />
        ))}
        {CLIENT_PREFIXES.map((p) => (
          <Route
            key={`${p}-fav`}
            path={`${p}/favorites`}
            element={
              <ProtectedRoute allow={["HOMEOWNER"]}>
                <FavoritesPage />
              </ProtectedRoute>
            }
          />
        ))}

        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-browse`}
            path={p}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <BrowseJobsPage />
              </ProtectedRoute>
            }
          />
        ))}
        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-job`}
            path={`${p}/jobs/:id`}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <ProJobDetailPage />
              </ProtectedRoute>
            }
          />
        ))}
        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-my`}
            path={`${p}/my-jobs`}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <MyJobsPage />
              </ProtectedRoute>
            }
          />
        ))}
        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-profile`}
            path={`${p}/profile`}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
        ))}
        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-analytics`}
            path={`${p}/analytics`}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
        ))}
        {PRO_PREFIXES.map((p) => (
          <Route
            key={`${p}-fav`}
            path={`${p}/favorites`}
            element={
              <ProtectedRoute allow={["TRADESPERSON"]}>
                <FavoritesPage />
              </ProtectedRoute>
            }
          />
        ))}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
