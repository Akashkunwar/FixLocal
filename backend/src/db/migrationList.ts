import { Baseline1790000000001 } from "../migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../migrations/1790000000002-AuditHardening";
import { LaunchReadiness1790000000003 } from "../migrations/1790000000003-LaunchReadiness";
import { JobAlerts1790000000004 } from "../migrations/1790000000004-JobAlerts";
import { Referrals1790000000005 } from "../migrations/1790000000005-Referrals";
import { JobAlertDigests1790000000006 } from "../migrations/1790000000006-JobAlertDigests";
import { AccountLanguage1790000000007 } from "../migrations/1790000000007-AccountLanguage";
import { ReferralCredits1790000000008 } from "../migrations/1790000000008-ReferralCredits";
import { TextMessaging1790000000009 } from "../migrations/1790000000009-TextMessaging";

/** Every migration in order (tests run exactly this list). */
export const ALL_MIGRATIONS = [
  Baseline1790000000001,
  AuditHardening1790000000002,
  LaunchReadiness1790000000003,
  JobAlerts1790000000004,
  Referrals1790000000005,
  JobAlertDigests1790000000006,
  AccountLanguage1790000000007,
  ReferralCredits1790000000008,
  TextMessaging1790000000009,
];
