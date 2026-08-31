import { NavLink } from "react-router-dom";

export function AdminNav() {
  return (
    <nav className="subnav">
      <NavLink to="/admin" end>
        Stats
      </NavLink>
      <NavLink to="/admin/tradespeople">Verify</NavLink>
      <NavLink to="/admin/disputes">Disputes</NavLink>
      <NavLink to="/admin/jobs">Jobs</NavLink>
    </nav>
  );
}
