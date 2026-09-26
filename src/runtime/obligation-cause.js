const FIELDS = ['eventType', 'eventId', 'correlationId', 'turnId'];

export function sanitizeObligationCause(cause) {
  if (cause == null) return null;
  return Object.fromEntries(FIELDS.map((key) => {
    const value = cause[key];
    return [key, typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 160) : null];
  }));
}
