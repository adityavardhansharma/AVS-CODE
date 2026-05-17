import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import * as CodexError from "../errors.ts";

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();
const THREAD_PAYLOAD_METHODS_REQUIRING_SESSION_ID_COMPAT = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/read",
  "thread/started",
]);

export const JsonRpcId = Schema.Union([Schema.Number, Schema.String]);

export const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

export const JsonRpcResponseEnvelope = Schema.Struct({
  id: JsonRpcId,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(JsonRpcError),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeThreadPayloadForDecode(method: string, raw: unknown): unknown {
  if (!THREAD_PAYLOAD_METHODS_REQUIRING_SESSION_ID_COMPAT.has(method) || !isRecord(raw)) {
    return raw;
  }
  const thread = raw.thread;
  if (!isRecord(thread) || typeof thread.id !== "string" || typeof thread.sessionId === "string") {
    return raw;
  }
  return {
    ...raw,
    thread: {
      ...thread,
      sessionId: thread.id,
    },
  };
}

export const decodeOptionalPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  raw: unknown,
): Effect.Effect<A, CodexError.CodexAppServerRequestError> => {
  if (!schema) {
    if (raw === undefined) {
      return Effect.sync(() => undefined as A);
    }
    return Effect.fail(
      CodexError.CodexAppServerRequestError.invalidParams(`${method} does not accept params`, raw),
    );
  }

  return Schema.decodeUnknownEffect(schema)(normalizeThreadPayloadForDecode(method, raw)).pipe(
    Effect.mapError((error) =>
      CodexError.CodexAppServerRequestError.invalidParams(
        `Invalid ${method} payload: ${formatSchemaIssue(error.issue)}`,
        { issue: error.issue },
      ),
    ),
  );
};

export const encodeOptionalPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  payload: A,
): Effect.Effect<I | undefined, CodexError.CodexAppServerRequestError> => {
  if (!schema) {
    if (payload === undefined) {
      return Effect.sync(() => undefined);
    }
    return Effect.fail(
      CodexError.CodexAppServerRequestError.invalidParams(
        `${method} does not accept params`,
        payload,
      ),
    );
  }

  return Schema.encodeEffect(schema)(payload).pipe(
    Effect.mapError((error) =>
      CodexError.CodexAppServerRequestError.invalidParams(
        `Invalid ${method} payload: ${formatSchemaIssue(error.issue)}`,
        { issue: error.issue },
      ),
    ),
  );
};

export const decodeNotificationPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  raw: unknown,
): Effect.Effect<A, CodexError.CodexAppServerProtocolParseError> =>
  decodeOptionalPayload(method, schema, raw).pipe(
    Effect.mapError(
      (error) =>
        new CodexError.CodexAppServerProtocolParseError({
          detail: error.message,
          cause: error,
        }),
    ),
  );

export const runHandler = Effect.fnUntraced(function* <A, B>(
  handler: ((payload: A) => Effect.Effect<B, CodexError.CodexAppServerError>) | undefined,
  payload: A,
  method: string,
) {
  if (!handler) {
    return yield* CodexError.CodexAppServerRequestError.methodNotFound(method);
  }

  return yield* handler(payload).pipe(
    Effect.mapError((error) => CodexError.normalizeToRequestError(error)),
  );
});
