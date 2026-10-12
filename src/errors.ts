import { GraphQLError, type GraphQLFormattedError } from 'graphql';

export const ErrorCode = {
  ADVISER_UNAVAILABLE: 'ADVISER_UNAVAILABLE',
  BAD_USER_INPUT: 'BAD_USER_INPUT',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;
type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Codes whose message we wrote ourselves and know to be safe to show. */
const SAFE_CODES: ReadonlySet<string> = new Set<string>([ErrorCode.ADVISER_UNAVAILABLE, ErrorCode.BAD_USER_INPUT]);

// Apollo's own validation/parse errors carry messages about the query, not our data.
const APOLLO_CLIENT_CODES: ReadonlySet<string> = new Set([
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  'OPERATION_RESOLUTION_FAILURE',
]);

export function safeError(message: string, code: ErrorCode): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

/**
 * Last line of defence: every error in the response passes through here.
 * Allow-list, not deny-list — anything we don't recognise is replaced wholesale,
 * and only message, path, locations and code survive. Stack traces, originalError,
 * and any other extension keys are dropped.
 */
export function formatError(formatted: GraphQLFormattedError, _error: unknown): GraphQLFormattedError {
  const rawCode = formatted.extensions?.['code'];
  const code = typeof rawCode === 'string' ? rawCode : ErrorCode.INTERNAL_SERVER_ERROR;
  const isSafe = SAFE_CODES.has(code) || APOLLO_CLIENT_CODES.has(code);

  return {
    message: isSafe ? formatted.message : 'An unexpected error occurred.',
    ...(formatted.path ? { path: formatted.path } : {}),
    ...(formatted.locations ? { locations: formatted.locations } : {}),
    extensions: { code: isSafe ? code : ErrorCode.INTERNAL_SERVER_ERROR },
  };
}
