/** Soft job templates per lead group — prefill title / description / category on post-job. */
export type JobTemplate = {
  id: string;
  label: string;
  title: string;
  description: string;
  category: string;
  siteType?: "residential" | "office";
};

export const JOB_TEMPLATES_BY_GROUP: Record<string, JobTemplate[]> = {
  "Home repair & maintenance": [
    {
      id: "plumb-leak",
      label: "Leaky faucet / pipe",
      title: "Kitchen or bath leak",
      description:
        "Describe the leak (drip vs spray), which fixture, and whether water can be shut off. Note access (under sink, wall panel).",
      category: "plumbing",
      siteType: "residential",
    },
    {
      id: "elec-outlet",
      label: "Outlet / switch issue",
      title: "Electrical outlet or switch not working",
      description:
        "Which rooms/circuits? Any burning smell or tripped MCB? Photos of the panel help.",
      category: "electrical",
      siteType: "residential",
    },
    {
      id: "paint-room",
      label: "Room painting",
      title: "Interior painting for one or more rooms",
      description:
        "Approx. sq ft, walls vs ceiling, furniture move needed, preferred paint brand if any.",
      category: "painting",
      siteType: "residential",
    },
    {
      id: "appliance-ac",
      label: "AC / appliance service",
      title: "Appliance repair or service",
      description:
        "Brand/model, error codes, last service date, and whether unit is under warranty.",
      category: "appliance",
      siteType: "residential",
    },
  ],
  Cleaning: [
    {
      id: "clean-deep",
      label: "Deep clean",
      title: "Deep cleaning for home or flat",
      description:
        "Rooms/bathrooms count, kitchen deep-clean needed, pets, preferred date window.",
      category: "cleaning",
      siteType: "residential",
    },
    {
      id: "clean-office",
      label: "Office clean",
      title: "Office / facilities cleaning",
      description:
        "Floor area, desks/cabins, washrooms, after-hours access, frequency (one-time vs recurring).",
      category: "cleaning",
      siteType: "office",
    },
  ],
  Construction: [
    {
      id: "const-minor",
      label: "Minor civil work",
      title: "Minor construction / civil repair",
      description:
        "Scope (tiling, plaster, waterproofing), materials provided?, site access and debris disposal.",
      category: "construction",
      siteType: "residential",
    },
  ],
  "Office & facilities": [
    {
      id: "office-fit",
      label: "Facilities fix",
      title: "Office facilities repair",
      description:
        "What’s broken (door, HVAC vent, pantry, washroom)? Building access hours and contact on site.",
      category: "office_facilities",
      siteType: "office",
    },
  ],
  "Tech services": [
    {
      id: "tech-cctv",
      label: "CCTV / networking",
      title: "CCTV, networking, or AMC visit",
      description:
        "Number of cameras/ports, existing DVR/NVR brand, cabling path, and preferred maintenance window.",
      category: "tech_services",
      siteType: "office",
    },
  ],
  Moving: [
    {
      id: "move-local",
      label: "Local move",
      title: "Local shifting / helpers",
      description:
        "From → to areas, floors/lift, inventory (beds, fridge), packing needed, preferred date.",
      category: "moving",
      siteType: "residential",
    },
  ],
  Other: [
    {
      id: "other-general",
      label: "General help",
      title: "Need a local professional",
      description:
        "Describe the work, site type, and any timing or access constraints.",
      category: "other",
    },
  ],
};

export function templatesForGroup(group: string): JobTemplate[] {
  return JOB_TEMPLATES_BY_GROUP[group] || JOB_TEMPLATES_BY_GROUP.Other || [];
}
