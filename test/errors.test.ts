import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SqlPadError, redact, setRedactionSecret } from '../src/client/errors.js';
import * as logger from '../src/logger.js';

const TOKEN = 'active-service-token';

describe('redact', () => {
  beforeEach(() => {
    setRedactionSecret(TOKEN);
  });

  afterEach(() => {
    setRedactionSecret('');
  });

  it('replaces every occurrence of both the active and explicitly supplied secrets', () => {
    const explicitSecret = 'one-off-secret';
    const output = redact(
      `${TOKEN}/${explicitSecret}/${TOKEN}/${explicitSecret}`,
      explicitSecret,
    );

    expect(output).toBe('[REDACTED]/[REDACTED]/[REDACTED]/[REDACTED]');
  });

  it('redacts overlapping secrets without leaving a suffix behind', () => {
    setRedactionSecret('token');

    expect(redact('token-with-suffix', 'token-with-suffix')).toBe('[REDACTED]');
  });

  it('redacts JSON-escaped and URL-encoded forms of a secret', () => {
    const secret = 'token "with spaces"';
    setRedactionSecret(secret);

    const structured = redact({ token: secret }, '');
    const encoded = redact(`token=${encodeURIComponent(secret)}`, '');

    expect(structured).toBe('{"token":"[REDACTED]"}');
    expect(encoded).toBe('token=[REDACTED]');
  });

  it('does not throw while redacting a malformed Unicode secret', () => {
    const secret = '\ud800';
    setRedactionSecret(secret);

    expect(redact(`token=${secret}`, '')).toBe('token=[REDACTED]');
  });

  it('serializes structured and circular values without exposing the active token', () => {
    const value: Record<string, unknown> = {
      token: TOKEN,
      count: 12n,
    };
    value.self = value;

    const output = redact(value, '');

    expect(output).toContain('[REDACTED]');
    expect(output).toContain('"count":"12"');
    expect(output).toContain('"self":"[Circular]"');
    expect(output).not.toContain(TOKEN);
  });

  it('redacts an Error stack and its nested cause', () => {
    const inner = new Error(`inner ${TOKEN}`);
    const outer = new Error(`outer ${TOKEN}`, { cause: inner });

    const output = redact(outer, '');

    expect(output).toContain('outer [REDACTED]');
    expect(output).toContain('inner [REDACTED]');
    expect(output).not.toContain(TOKEN);
  });
});

describe('SqlPadError', () => {
  beforeEach(() => {
    setRedactionSecret(TOKEN);
  });

  afterEach(() => {
    setRedactionSecret('');
  });

  it.each([
    [400, 'SQLPad rejected the request. Check the supplied parameters.'],
    [401, 'SQLPad rejected the service token. Verify the token and that the server has SQLPAD_SERVICE_TOKEN_SECRET configured.'],
    [403, 'This operation requires an admin service token.'],
    [404, 'The requested SQLPad resource was not found.'],
    [500, 'SQLPad encountered an internal server error.'],
  ])('composes the actionable status message and SQLPad title for HTTP %i', (status, statusMessage) => {
    const title = `Specific SQLPad error ${TOKEN}.`;
    const error = new SqlPadError(`unsafe fallback ${TOKEN}`, { status, title });

    expect(error).toMatchObject({
      name: 'SqlPadError',
      status,
      message: `${statusMessage} Specific SQLPad error [REDACTED].`,
    });
    expect(error.message).not.toContain(TOKEN);
  });

  it('keeps the bare status message when SQLPad provides no title', () => {
    const error = new SqlPadError('SQLPad request failed with status 403.', { status: 403 });

    expect(error.message).toBe('This operation requires an admin service token.');
  });

  it('redacts its message, title, detail, stack, and nested Error causes', () => {
    const rootCause = new Error(`root ${TOKEN}`);
    const cause = new TypeError(`request ${TOKEN}`, { cause: rootCause });
    const error = new SqlPadError(`failed with ${TOKEN}`, {
      title: `title ${TOKEN}`,
      detail: `detail ${TOKEN}`,
      cause,
    });

    expect(error.message).toBe('failed with [REDACTED]');
    expect(error.title).toBe('title [REDACTED]');
    expect(error.detail).toBe('detail [REDACTED]');
    expect(error.stack).not.toContain(TOKEN);

    const sanitizedCause = error.cause as Error & { cause?: Error };
    expect(sanitizedCause).not.toBe(cause);
    expect(sanitizedCause.name).toBe('TypeError');
    expect(sanitizedCause.message).toBe('request [REDACTED]');
    expect(sanitizedCause.stack).not.toContain(TOKEN);
    expect(sanitizedCause.cause?.message).toBe('root [REDACTED]');
    expect(sanitizedCause.cause?.stack).not.toContain(TOKEN);
  });

  it('redacts non-Error causes before attaching them', () => {
    const error = new SqlPadError('request failed', {
      cause: { authorization: `Bearer ${TOKEN}` },
    });

    expect(String(error.cause)).toContain('Bearer [REDACTED]');
    expect(String(error.cause)).not.toContain(TOKEN);
  });

  it('handles a cyclic Error cause without recursing forever', () => {
    const cause = new Error(`cycle ${TOKEN}`);
    Object.defineProperty(cause, 'cause', { value: cause });

    const error = new SqlPadError('request failed', { cause });
    const sanitizedCause = error.cause as Error & { cause?: unknown };

    expect(sanitizedCause.message).toBe('cycle [REDACTED]');
    expect(sanitizedCause.cause).toBe('[Circular]');
  });
});

describe('logger', () => {
  beforeEach(() => {
    setRedactionSecret(TOKEN);
  });

  afterEach(() => {
    setRedactionSecret('');
    vi.restoreAllMocks();
  });

  it('writes every level only to stderr and never exposes the active token', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.debug('debug', TOKEN);
    logger.info({ authorization: `Bearer ${TOKEN}` });
    logger.warn(new Error(`warning ${TOKEN}`));
    logger.error('error', `detail=${TOKEN}`);

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(4);

    const output = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(output).toContain('[debug] debug [REDACTED]\n');
    expect(output).toContain('[info] {"authorization":"Bearer [REDACTED]"}\n');
    expect(output).toContain('[warn] Error: warning [REDACTED]');
    expect(output).toContain('[error] error detail=[REDACTED]\n');
    expect(output).not.toContain(TOKEN);
  });
});
