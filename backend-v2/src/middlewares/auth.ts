import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { errorResponse } from '../utils/responseFormat';
import { logger } from '../utils/logger';

export const ACCESS_COOKIE = 'edusphere_at';
export const REFRESH_COOKIE = 'edusphere_rt';

/**
 * Populates req.user from the access token. Accepts an Authorization: Bearer
 * header or the access cookie, header first, so both browser and
 * server-to-server callers work.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    token = req.cookies?.[ACCESS_COOKIE];
  }

  if (!token) {
    return res.status(401).json(errorResponse('Unauthorized: missing token'));
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json(errorResponse('Unauthorized: invalid or expired token'));
  }

  req.user = decoded;
  next();
};

export const requireRole =
  (roles: TokenPayload['role'][]) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(errorResponse('Unauthorized'));
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(
        `Role denied: user ${req.user.userId} is ${req.user.role}, needs one of [${roles.join(', ')}]`
      );
      return res.status(403).json(errorResponse('Forbidden: insufficient role'));
    }

    next();
  };

/**
 * Asserts the caller is bound to a tenant, so downstream handlers can rely on
 * `req.user.schoolId` being present and pass it to withTenant().
 *
 * This is a precondition check, not the isolation mechanism. Isolation is
 * enforced by Row-Level Security in the database; if this middleware were
 * removed, queries would return nothing rather than another school's data.
 *
 * SUPER_ADMIN is rejected here by design: the platform owner has no school, so
 * a tenant-scoped route is meaningless for them. Cross-tenant routes use
 * requireRole(['SUPER_ADMIN']) with asSuperAdmin() instead.
 */
export const requireTenant = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Unauthorized'));
  }

  if (!req.user.schoolId) {
    return res
      .status(403)
      .json(errorResponse('Forbidden: this endpoint requires a school-scoped account'));
  }

  next();
};
