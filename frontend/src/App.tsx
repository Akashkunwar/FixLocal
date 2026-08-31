import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { dashboardPath } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminStatsPage } from "./pages/admin/AdminStatsPage";
import { AdminTradespeoplePage } from "./pages/admin/AdminTradespeoplePage";
import { AdminDisputesPage } from "./pages/admin/AdminDisputesPage";
import { AdminJobsPage } from "./pages/admin/AdminJobsPage";
import { HomeownerDashboard } from "./pages/homeowner/HomeownerDashboard";
import { CreateJobPage } from "./pages/homeowner/CreateJobPage";
import { JobDetailPage } from "./pages/homeowner/JobDetailPage";
import { BrowseJobsPage } from "./pages/tradesperson/BrowseJobsPage";
import { ProJobDetailPage } from "./pages/tradesperson/ProJobDetailPage";
import { MyJobsPage } from "./pages/tradesperson/MyJobsPage";
import { ProfilePage } from "./pages/tradesperson/ProfilePage";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={dashboardPath(user.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allow={["ADMIN"]}>
            <AdminStatsPage />
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
        path="/homeowner"
        element={
          <ProtectedRoute allow={["HOMEOWNER"]}>
            <HomeownerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/homeowner/jobs/new"
        element={
          <ProtectedRoute allow={["HOMEOWNER"]}>
            <CreateJobPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/homeowner/jobs/:id"
        element={
          <ProtectedRoute allow={["HOMEOWNER"]}>
            <JobDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tradesperson"
        element={
          <ProtectedRoute allow={["TRADESPERSON"]}>
            <BrowseJobsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tradesperson/jobs/:id"
        element={
          <ProtectedRoute allow={["TRADESPERSON"]}>
            <ProJobDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tradesperson/my-jobs"
        element={
          <ProtectedRoute allow={["TRADESPERSON"]}>
            <MyJobsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tradesperson/profile"
        element={
          <ProtectedRoute allow={["TRADESPERSON"]}>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
