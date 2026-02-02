import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Defensive: Polkadot.js _unsubscribeHealth can throw ".__internal__healthTimer is read-only"
// in SES/frozen environments (sandbox, extension). Catch so the UI stays usable.
const POLKADOT_HEALTH_TIMER_READONLY = '__internal__healthTimer';
function isPolkadotHealthTimerReadOnlyError(error: unknown): boolean {
  if (error instanceof TypeError && error.message?.includes(POLKADOT_HEALTH_TIMER_READONLY)) {
    return true;
  }
  const msg = error && typeof (error as Error).message === 'string' ? (error as Error).message : String(error);
  return msg.includes(POLKADOT_HEALTH_TIMER_READONLY) && (msg.includes('read-only') || msg.includes('readonly'));
}

window.addEventListener('error', (event) => {
  if (isPolkadotHealthTimerReadOnlyError(event.error)) {
    console.warn('[DotBot] Caught Polkadot.js SES healthTimer error (disconnect cleanup). UI unaffected.', event.error?.message ?? event.message);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (isPolkadotHealthTimerReadOnlyError(event.reason)) {
    console.warn('[DotBot] Caught Polkadot.js SES healthTimer rejection. UI unaffected.', event.reason?.message ?? event.reason);
    event.preventDefault();
  }
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
