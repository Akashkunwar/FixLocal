import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath, type Role } from "../api/client";
import { Spinner } from "./ui/Spinner";

type Props = {
  allow: Role[];
  children: React.ReactNode;
};

export function ProtectedRoute({ allow, children }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  return <>{children}</>;
}
