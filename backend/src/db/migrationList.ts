import { Baseline1790000000001 } from "../migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../migrations/1790000000002-AuditHardening";
import { LaunchReadiness1790000000003 } from "../migrations/1790000000003-LaunchReadiness";
import { JobAlerts1790000000004 } from "../migrations/1790000000004-JobAlerts";

/** Every migration in order (tests run exactly this list). */
export const ALL_MIGRATIONS = [
  Baseline1790000000001,
  AuditHardening1790000000002,
  LaunchReadiness1790000000003,
  JobAlerts1790000000004,
];
