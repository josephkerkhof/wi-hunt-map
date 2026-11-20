import { readFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';

const api = 'http://127.0.0.1:8787/api/alerts/test';

async function request(token, method, body) {
  const response = await fetch(api, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error('Couldn’t connect to Field Hours. Start the stack with devenv up.');
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || result === null) {
    throw new Error(result?.message ?? 'The local test service is unavailable.');
  }

  return result;
}

async function main() {
  if (!stdin.isTTY) throw new Error('Run test-notification in an interactive terminal.');

  const config = await readFile(new URL('../worker/.dev.vars', import.meta.url), 'utf8').catch(
    () => '',
  );

  const { LOCAL_ALERT_TEST_TOKEN: token } = parseEnv(config);

  if (!token) throw new Error('Start the Field Hours stack with devenv up.');
  const devices = await request(token, 'GET');

  if (devices.length === 0) {
    throw new Error('Open Field Hours on the device you want to test and keep the app visible.');
  }

  for (const [index, device] of devices.entries()) console.log(`${index + 1}. ${device.label}`);
  const terminal = createInterface({ input: stdin, output: stdout });

  try {
    const number = Number((await terminal.question('Choose a device [1] ')).trim() || '1');
    const device = devices[number - 1];

    if (!Number.isInteger(number) || !device) throw new Error('Choose a device from the list.');

    const message =
      (await terminal.question('Message [This is a Field Hours test notification.] ')).trim() ||
      'This is a Field Hours test notification.';

    if (message.length > 200) throw new Error('Use a message of 200 characters or fewer.');
    const confirmation = await terminal.question(`Send to ${device.label}? [y/N] `);

    if (!/^y(?:es)?$/i.test(confirmation.trim())) return;
    const result = await request(token, 'POST', JSON.stringify({ device: device.id, message }));
    console.log(result.message);
  } finally {
    terminal.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
