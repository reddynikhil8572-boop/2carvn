import type { TokenPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth from a verified access token. */
      user?: TokenPayload;
      /**
       * Parsed query set by the validateQuery middleware. Express 5 makes
       * req.query read-only, so validated query params land here instead.
       */
      validatedQuery?: Record<string, unknown>;
      /** Correlation id set by the requestId middleware; echoed to the client. */
      requestId?: string;
    }
  }
}

export {};
