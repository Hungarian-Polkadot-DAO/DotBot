/**
 * Run before any @polkadot/api code loads so the library captures our patched console.
 * Suppresses noisy WsProvider disconnect logs (API-WS: disconnected ... 1006 Abnormal Closure).
 */
(function patchPolkadotWsDisconnectLogs(): void {
  if (typeof console === 'undefined' || !console.error) return;
  const key = '__dotbot_polkadot_ws_suppress_patched__';
  if ((console as unknown as Record<string, unknown>)[key]) return;
  (console as unknown as Record<string, unknown>)[key] = true;
  const orig = console.error.bind(console);
  (console as unknown as { error: (...args: unknown[]) => void }).error = (...args: unknown[]) => {
    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (msg.includes('API-WS') && (msg.includes('disconnected') || msg.includes('1006') || msg.includes('Abnormal Closure'))) return;
    orig(...args);
  };
})();
