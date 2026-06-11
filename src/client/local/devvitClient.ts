const localToastHostId = 'emuarcade-local-toast-host';

const ensureToastHost = () => {
  const existingHost = document.getElementById(localToastHostId);

  if (existingHost) {
    return existingHost;
  }

  const host = document.createElement('div');

  host.id = localToastHostId;
  Object.assign(host.style, {
    bottom: '20px',
    display: 'grid',
    gap: '8px',
    left: '50%',
    maxWidth: 'min(420px, calc(100vw - 32px))',
    position: 'fixed',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
  });
  document.body.appendChild(host);

  return host;
};

export const showToast = (message: string) => {
  const host = ensureToastHost();
  const toast = document.createElement('div');

  toast.textContent = message;
  Object.assign(toast.style, {
    background: '#111315',
    border: '1px solid #3a3f3b',
    borderRadius: '6px',
    boxShadow: '0 12px 34px rgba(0, 0, 0, 0.4)',
    color: '#f7f3ea',
    font: '600 14px system-ui, sans-serif',
    padding: '10px 14px',
    textAlign: 'center',
  });
  host.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
};

export const navigateTo = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

export const requestExpandedMode = (_event: Event, entrypoint = 'game') => {
  const target = entrypoint === 'game' ? '/game.html' : '/splash.html';

  if (
    window.parent !== window &&
    window.parent.location.origin === window.location.origin
  ) {
    window.parent.location.href = target;
    return;
  }

  window.location.href = target;
};
