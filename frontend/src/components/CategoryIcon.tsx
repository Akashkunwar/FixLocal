import {
  Building2,
  Cctv,
  Droplets,
  Hammer,
  HardHat,
  House,
  Lightbulb,
  PaintRoller,
  SprayCan,
  Truck,
  WashingMachine,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** One flat line icon per job category (same stroke and size everywhere). */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  plumbing: Droplets,
  electrical: Lightbulb,
  carpentry: Hammer,
  painting: PaintRoller,
  appliance: WashingMachine,
  cleaning: SprayCan,
  construction: HardHat,
  office_facilities: Building2,
  tech_services: Cctv,
  moving: Truck,
  other: Wrench,
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  "Home repair & maintenance": House,
  Cleaning: SprayCan,
  Construction: HardHat,
  "Office & facilities": Building2,
  "Tech services": Cctv,
  Moving: Truck,
  Other: Wrench,
};

export function categoryIconFor(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Wrench;
}

export function leadGroupIconFor(group: string): LucideIcon {
  return GROUP_ICONS[group] ?? Wrench;
}

type Size = "xs" | "sm" | "md" | "lg";
const TILE: Record<Size, string> = {
  xs: "h-5 w-5 rounded-md",
  sm: "h-7 w-7 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-12 w-12 rounded-2xl",
};
const GLYPH: Record<Size, string> = { xs: "h-3.5 w-3.5", sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" };

type Props = {
  size?: Size;
  /** Soft brand-tinted rounded tile behind the icon. */
  tile?: boolean;
  /** Follow the surrounding text colour (for chips that turn dark when selected). */
  inherit?: boolean;
  className?: string;
};

function Glyph({ Icon, size = "sm", tile = false, inherit = false, className = "" }: Props & { Icon: LucideIcon }) {
  if (!tile) {
    const tone = inherit ? "" : "text-brand-700";
    return <Icon className={`inline-block shrink-0 align-[-0.15em] ${tone} ${GLYPH[size]} ${className}`} strokeWidth={1.75} aria-hidden />;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-brand-50 text-brand-700 ring-1 ring-brand-100 ${TILE[size]} ${className}`}
      aria-hidden
    >
      <Icon className={GLYPH[size]} strokeWidth={1.75} />
    </span>
  );
}

/** Decorative category icon; the category name is always shown as text next to it. */
export function CategoryIcon({ category, ...rest }: Props & { category: string }) {
  return <Glyph Icon={categoryIconFor(category)} {...rest} />;
}

/** Decorative icon for a lead group (Home repair, Cleaning, …). */
export function LeadGroupIcon({ group, ...rest }: Props & { group: string }) {
  return <Glyph Icon={leadGroupIconFor(group)} {...rest} />;
}
