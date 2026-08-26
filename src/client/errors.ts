let activeSecret = '';

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: 'SQLPad rejected the request. Check the supplied parameters.',
  401: 'SQLPad rejected the service token. Verify the token and that the server has SQLPAD_SERVICE_TOKEN_SECRET configured.',
  403: 'This operation requires an admin service token.',
  404: 'The requested SQLPad resource was not found.',
  500: 'SQLPad encountered an internal server error.',
};

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    const cause = 'cause' in value ? `\nCaused by: ${stringify(value.cause)}` : '';
    return `${value.stack ?? value.message}${cause}`;
  }
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') {
        return item.toString();
      }
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {
          return '[Circular]';
        }
        seen.add(item);
      }
      if (item instanceof Error) {
        return {
          name: item.name,
          message: item.message,
          stack: item.stack,
          cause: 'cause' in item ? item.cause : undefined,
        };
      }
      return item;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function secretForms(secret: string): string[] {
  const forms = [secret, JSON.stringify(secret).slice(1, -1)];
  try {
    forms.push(encodeURIComponent(secret));
  } catch {
    // Raw and JSON-escaped forms still provide safe redaction for malformed Unicode.
  }
  return forms;
}

export function redact(value: unknown, secret: string): string {
  const secrets = [...new Set([activeSecret, secret]
    .filter((candidate) => candidate.length > 0)
    .flatMap(secretForms))]
    .sort((left, right) => right.length - left.length);
  let output = stringify(value);
  for (const candidate of secrets) {
    output = output.split(candidate).join('[REDACTED]');
  }
  return output;
}

export function setRedactionSecret(secret: string): void {
  activeSecret = secret;
}

function sanitizeCause(cause: unknown, seen = new WeakSet<object>()): unknown {
  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return '[Circular]';
    }
    seen.add(cause);
    const sanitized = new Error(redact(cause.message, ''));
    sanitized.name = cause.name;
    sanitized.stack = cause.stack ? redact(cause.stack, '') : sanitized.stack;
    if ('cause' in cause) {
      Object.defineProperty(sanitized, 'cause', {
        configurable: true,
        value: sanitizeCause(cause.cause, seen),
      });
    }
    return sanitized;
  }
  return redact(cause, '');
}

export class SqlPadError extends Error {
  status?: number;
  title?: string;
  detail?: string;

  constructor(
    message: string,
    opts: {
      status?: number;
      title?: string;
      detail?: string;
      cause?: unknown;
    } = {},
  ) {
    const statusMessage = opts.status === undefined ? undefined : STATUS_MESSAGES[opts.status];
    const composedMessage = statusMessage === undefined
      ? message
      : opts.title !== undefined && opts.title !== statusMessage
        ? `${statusMessage} ${opts.title}`
        : statusMessage;
    super(redact(composedMessage, ''));
    this.name = 'SqlPadError';
    this.status = opts.status;
    this.title = opts.title === undefined ? undefined : redact(opts.title, '');
    this.detail = opts.detail === undefined ? undefined : redact(opts.detail, '');
    if (opts.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        value: sanitizeCause(opts.cause),
      });
    }
  }
}
