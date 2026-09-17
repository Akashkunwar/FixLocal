import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export type ValidationIssue = { path: string; message: string };

export class ValidationFailure extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("Invalid request");
    this.issues = issues;
  }
}

type Schemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

const PARTS = ["params", "query", "body"] as const;

/** Parse params/query/body with zod; parsed values land on req.valid. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: ValidationIssue[] = [];
    const out: Record<string, unknown> = {};
    for (const part of PARTS) {
      const raw = (req as unknown as Record<string, unknown>)[part] ?? {};
      const schema = schemas[part];
      if (!schema) {
        out[part] = raw;
        continue;
      }
      const result = schema.safeParse(raw);
      if (result.success) {
        out[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({
            path: [part, ...issue.path.map(String)].join("."),
            message: issue.message,
          });
        }
      }
    }
    if (issues.length) return next(new ValidationFailure(issues));
    req.valid = out as Request["valid"];
    next();
  };
}
