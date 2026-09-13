import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

/**
 * Zod validation middleware factory.
 * Validates req.body and replaces it with the parsed result, so handlers see
 * only declared fields. Use `.strict()` on schemas to reject unknown keys and
 * close off mass assignment.
 *
 * Usage: router.post('/route', validate(mySchema), controller)
 */
export const validate =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next({
        name: 'ZodError',
        statusCode: 422,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
        message: 'Validation failed',
      });
      return;
    }

    req.body = result.data;
    next();
  };

/**
 * Validates req.params.
 */
export const validateParams =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      next({
        name: 'ZodError',
        statusCode: 422,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'params',
          message: issue.message,
        })),
        message: 'Invalid URL parameters',
      });
      return;
    }

    req.params = result.data as Record<string, string>;
    next();
  };

/**
 * Validates req.query.
 *
 * Express 5 exposes `req.query` as a getter with no setter, so the parsed
 * result is attached to `req.validatedQuery` instead of overwriting it.
 * Handlers should read `req.validatedQuery` when this middleware is applied.
 */
export const validateQuery =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      next({
        name: 'ZodError',
        statusCode: 422,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'query',
          message: issue.message,
        })),
        message: 'Invalid query parameters',
      });
      return;
    }

    req.validatedQuery = result.data as Record<string, unknown>;
    next();
  };
