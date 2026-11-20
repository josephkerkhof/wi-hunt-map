import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installPlatform, safariVersion } from '../src/install-platform';

const iphoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';

const iphoneSafari18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const ipadSafari =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';

const iphoneChrome =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1';

const iphoneFacebook =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.40.104;FBBV/123;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]';

const iphoneWebView =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const androidChrome =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

const androidInstagram =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android';

const macSafari =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';

const windowsChrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

test('iPhone and iPad Safari get the Safari steps', () => {
  assert.equal(installPlatform(iphoneSafari, 5), 'ios-safari');
  assert.equal(installPlatform(ipadSafari, 5), 'ios-safari');
});

test('other iPhone browsers get the share sheet steps', () => {
  assert.equal(installPlatform(iphoneChrome, 5), 'ios-browser');
});

test('browsers inside other apps are sent to the system browser', () => {
  assert.equal(installPlatform(iphoneFacebook, 5), 'ios-app');
  assert.equal(installPlatform(iphoneWebView, 5), 'ios-app');
  assert.equal(installPlatform(androidInstagram, 5), 'android-app');
});

test('Android browsers get the Android steps', () => {
  assert.equal(installPlatform(androidChrome, 5), 'android');
});

test('computers get the phone handoff', () => {
  assert.equal(installPlatform(macSafari, 0), 'desktop');
  assert.equal(installPlatform(windowsChrome, 0), 'desktop');
});

test('the Safari version selects the menu layout', () => {
  assert.equal(safariVersion(iphoneSafari), 26);
  assert.equal(safariVersion(iphoneSafari18), 18);
  assert.equal(safariVersion(iphoneChrome), 0);
});
