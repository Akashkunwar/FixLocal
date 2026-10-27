import { Baseline1790000000001 } from "../migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../migrations/1790000000002-AuditHardening";
import { LaunchReadiness1790000000003 } from "../migrations/1790000000003-LaunchReadiness";

/** Every migration in order (tests run exactly this list). */
export const ALL_MIGRATIONS = [Baseline1790000000001, AuditHardening1790000000002, LaunchReadiness1790000000003];
