import { NavLink } from "react-router-dom";

export function ProNav() {
  return (
    <nav className="subnav">
      <NavLink to="/tradesperson" end>
        Browse jobs
      </NavLink>
      <NavLink to="/tradesperson/my-jobs">My jobs</NavLink>
      <NavLink to="/tradesperson/profile">Profile</NavLink>
    </nav>
  );
}
