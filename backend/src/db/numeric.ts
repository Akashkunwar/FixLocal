import type { ValueTransformer } from "typeorm";

/** Postgres returns numeric/decimal as strings; convert to numbers at the entity boundary. */
export const numeric: ValueTransformer = {
  to: (value?: number | string | null) => (value === undefined ? undefined : value),
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
