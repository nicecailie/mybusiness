export function newOperationId(): string {
  const api = globalThis.crypto;
  if (typeof api?.randomUUID === 'function') return api.randomUUID();

  // randomUUID is restricted to secure contexts, but getRandomValues remains
  // available in browsers that open a local dev server over an HTTP LAN URL.
  if (typeof api?.getRandomValues === 'function') {
    const bytes = api.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Idempotency keys identify retries; they are not credentials or secrets.
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
