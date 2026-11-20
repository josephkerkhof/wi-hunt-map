import { $ } from './elements';
import {
  installPlatform,
  isStandalone,
  safariVersion,
  type InstallPlatform,
} from './install-platform';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Navigator {
    getInstalledRelatedApps?(): Promise<{ platform: string }[]>;
    readonly standalone?: boolean;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const snoozeKey = 'field-hours.install-snoozed-until';
const confirmedKey = 'field-hours.install-confirmed';
const welcomedKey = 'field-hours.install-welcomed';
const snoozeMs = 14 * 24 * 60 * 60 * 1000;

const guides = {
  'ios-safari': 'ios-safari',
  'ios-browser': 'ios-browser',
  'ios-app': 'in-app',
  android: 'android',
  'android-app': 'in-app',
  desktop: 'desktop',
} satisfies Record<InstallPlatform, string>;

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still applies until the page reloads.
  }
}

// Links with ?install open the guide. The Home Screen app must not keep the parameter.
function takeInstallParameter() {
  const url = new URL(location.href);

  if (!url.searchParams.has('install')) return false;
  url.searchParams.delete('install');
  history.replaceState(history.state, '', url);

  return true;
}

async function hasInstalledApp() {
  try {
    const apps = await navigator.getInstalledRelatedApps?.();

    return apps?.some(app => app.platform === 'webapp') ?? false;
  } catch {
    return false;
  }
}

async function renderQrCode(url: string) {
  const box = $('install-qr');
  const svg = box.querySelector('svg');
  const path = box.querySelector('path');

  try {
    const { encode } = await import('uqr');
    const { data, size } = encode(url, { ecc: 'M', border: 0 });

    const modules = data.flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
    );

    svg?.setAttribute('viewBox', `-4 -4 ${size + 8} ${size + 8}`);
    path?.setAttribute('d', modules.join(''));
  } catch (error) {
    box.hidden = true;
    console.warn('QR code unavailable.', error);
  }
}

function renderGuide(platform: InstallPlatform, shareUrl: URL) {
  const guide = guides[platform];
  const browser = platform === 'android-app' ? 'Chrome' : 'Safari';
  const modernSafari = safariVersion(navigator.userAgent) >= 26;

  $(`install-${guide}`).hidden = false;
  $('safari-menu-step').hidden = !modernSafari;
  $('safari-share-step').hidden = modernSafari;
  $('install-copy-block').hidden = guide !== 'in-app' && guide !== 'ios-browser';
  $('install-done').hidden = guide === 'in-app' || guide === 'desktop';

  if (guide === 'desktop') $('install-dialog-title').textContent = 'Get Field Hours on your phone';

  // "Open in Safari" uses the current address, so the guide opens there too.
  if (guide === 'in-app') history.replaceState(history.state, '', shareUrl);

  document.querySelectorAll('[data-browser-name]').forEach(name => {
    name.textContent = browser;
  });

  document.querySelectorAll('[data-app-url]').forEach(address => {
    address.textContent = (shareUrl.host + shareUrl.pathname).replace(/\/$/, '');
  });

  $('install-copy').addEventListener('click', async () => {
    const status = $('install-copy-status');

    try {
      await navigator.clipboard.writeText(shareUrl.href);
      status.textContent = `Link copied. Open ${browser} and paste it in the address bar.`;
    } catch {
      status.textContent = `Couldn’t copy the link. Open ${browser} and go to ${shareUrl.host}.`;
    }
  });

  if (guide === 'desktop') void renderQrCode(shareUrl.href);
}

function showWelcome(hasLocation: boolean) {
  if (stored(welcomedKey) === 'true') return;
  const welcome = $('welcome-banner');

  $('welcome-message').textContent = hasLocation
    ? 'Field Hours is on your Home Screen and works with no signal.'
    : 'Field Hours is on your Home Screen. Choose your hunt location while you have signal.';

  welcome.hidden = false;

  $('dismiss-welcome').addEventListener('click', () => {
    store(welcomedKey, 'true');
    const hadFocus = welcome.contains(document.activeElement);
    welcome.hidden = true;

    if (hadFocus) $('main').focus({ preventScroll: true });
  });
}

export async function setupInstallGuide(hasLocation: boolean) {
  const openOnLoad = takeInstallParameter();

  if (isStandalone()) {
    showWelcome(hasLocation);

    return;
  }

  const platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const dialog = $('install-dialog', HTMLDialogElement);
  const banner = $('install-banner');
  const headerButton = $('header-install', HTMLButtonElement);
  let installPrompt: BeforeInstallPromptEvent | null = null;
  let bannerClosed = false;

  renderGuide(platform, new URL('./?install', location.href));

  if (platform === 'desktop') $('header-install-label').textContent = 'Get it on your phone';

  function usePrompt(event: BeforeInstallPromptEvent | null) {
    installPrompt = event;
    $('install-label').textContent = event ? 'Install app' : 'Show me how';
  }

  function showControl(control: 'banner' | 'button' | 'none') {
    const hadFocus = banner.contains(document.activeElement);
    bannerClosed ||= control !== 'banner';
    banner.hidden = control !== 'banner';
    headerButton.hidden = control !== 'button';

    if (hadFocus && control !== 'banner') {
      (control === 'button' ? headerButton : $('main')).focus({ preventScroll: true });
    }
  }

  async function install(trigger: HTMLElement) {
    trigger.closest('dialog')?.close();

    if (!installPrompt) {
      dialog.showModal();

      return;
    }

    const prompt = installPrompt;
    usePrompt(null);

    try {
      const { outcome } = await prompt.prompt();

      if (outcome === 'accepted') showControl('none');
    } catch {
      dialog.showModal();
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    usePrompt(event);
  });

  window.addEventListener('appinstalled', () => {
    usePrompt(null);
    showControl('none');
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-install]').forEach(button => {
    button.addEventListener('click', () => void install(button));
  });

  $('dismiss-install').addEventListener('click', () => {
    store(snoozeKey, String(Date.now() + snoozeMs));
    showControl('button');
  });

  $('install-done').addEventListener('click', () => {
    store(confirmedKey, 'true');
    dialog.close();
    showControl('button');
  });

  if (openOnLoad) dialog.showModal();

  if ((await hasInstalledApp()) || bannerClosed) return;

  const offerBanner =
    platform !== 'desktop' &&
    stored(confirmedKey) !== 'true' &&
    Number(stored(snoozeKey)) <= Date.now();

  showControl(offerBanner ? 'banner' : 'button');
}
