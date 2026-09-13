import type { ValidationIssue } from '@/types/api';

/**
 * Normalise any error thrown by Axios (or anything else) into a structured
 * shape the UI can render. Network errors, timeouts, and non-JSON responses
 * all get human-readable messages while preserving the parsed body when
 * available.
 */

export interface NormalisedApiError {
  /** HTTP status code, or 0 for network failures. */
  status: number;
  /** Human-readable message safe for the UI. */
  message: string;
  /** Structured meta from the backend (e.g. retryAfter, requestId, code). */
  meta: Record<string, unknown>;
  /** Field-level validation failures, when present. */
  validationErrors: ValidationIssue[];
}

/**
 * Isolates the code path for parsing the backend's standard error body —
 * ensures validation-error detection is never duplicated.
 */
function parseErrorBody(payload: unknown): Omit<NormalisedApiError, 'status'> {
  if (typeof payload !== 'object' || payload === null) {
    return { message: 'An unexpected error occurred.', meta: {}, validationErrors: [] };
  }

  const body = payload as Record<string, unknown>;
  const message = typeof body.message === 'string'
    ? body.message
    : 'An unexpected error occurred.';
  const meta = (body.data ?? {}) as Record<string, unknown>;

  const validationErrors: ValidationIssue[] = Array.isArray(body.errors)
    ? (body.errors as unknown[]).filter(
        (e): e is ValidationIssue =>
          typeof e === 'object' &&
          e !== null &&
          'field' in e &&
          'message' in e,
      )
    : [];

  return { message, meta, validationErrors };
}

export function normaliseError(error: unknown): NormalisedApiError {
  // Axios errors carry a `response` and/or `request` property.
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosErr = error as {
      isAxiosError: true;
      response?: { status: number; data: unknown };
      request?: unknown;
      message: string;
    };

    if (axiosErr.response) {
      const { status, data } = axiosErr.response;
      const parsed = parseErrorBody(data);
      // 501 = an endpoint exists but its backing infrastructure doesn't
      // (the backend answers 501 when object storage is unconfigured). Render
      // that as a calm "feature unavailable" rather than a raw server error.
      if (status === 501) {
        return {
          status: 501,
          message:
            "This feature is currently unavailable — object storage isn't configured for this instance.",
          meta: parsed.meta,
          validationErrors: [],
        };
      }
      return { status, ...parsed };
    }

    // Request was made but no response received (network / CORS / timeout).
    if (axiosErr.request) {
      return {
        status: 0,
        message: 'Network error — please check your connection and try again.',
        meta: {},
        validationErrors: [],
      };
    }
  }

  // Fallback for non-Axios errors.
  return {
    status: 0,
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    meta: {},
    validationErrors: [],
  };
}
