export type InstallPlatform =
  | 'ios-safari'
  | 'ios-browser'
  | 'ios-app'
  | 'android'
  | 'android-app'
  | 'desktop';

// Browsers built into other apps can't add pages to the Home Screen.
const appBrowser =
  /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|TikTok|musical_ly|Bytedance|Pinterest|Twitter|\bLine\/|GSA\//;

const iosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Ddg\/|YaBrowser/;

export function installPlatform(userAgent: string, touchPoints: number): InstallPlatform {
  // iPadOS Safari reports a Mac user agent.
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);

  if (ios) {
    if (appBrowser.test(userAgent) || !/Safari\//.test(userAgent)) return 'ios-app';

    return iosBrowser.test(userAgent) ? 'ios-browser' : 'ios-safari';
  }

  if (/Android/.test(userAgent)) {
    return appBrowser.test(userAgent) || /; wv\)/.test(userAgent) ? 'android-app' : 'android';
  }

  return 'desktop';
}

export function safariVersion(userAgent: string) {
  return Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0);
}

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
