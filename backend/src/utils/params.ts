import { Request } from "express";

/** Express 5 typings allow string | string[]; normalize to a single string. */
export function param(req: Request, key: string): string {
  const v = req.params[key];
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}
