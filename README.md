# Field Hours

Field Hours is a progressive web app (PWA) to help Wisconsin deer hunters know precisely when their shooting hours are in the field based on the hunter's location.

<img width="1382" height="1340" alt="image" src="https://github.com/user-attachments/assets/e246acab-cd32-4db0-af54-9b3276fed853" />

Try it out at [deer.kerkhof.dev](https://deer.kerkhof.dev).

## Motivation

The Wisconsin DNR annually publishes a hunting regulations brochure which includes a lookup table with your shooting hours. The steps are straightforward, but can be cumbersome and tedious when the hunter is in the field. The steps go as follows:

0. Determine if you're in the Northern or Southern section of Wisconsin (drawn by county lines).
1. Go to the correct lookup table (Northern or Southern).
2. Using the date, find the AM / PM hours.
3. Determine your zone and add your offset to the AM / PM hours from step 2.

<img width="660" height="898" alt="Wisconsin DNR Hunting Area and Zone map" src="https://github.com/user-attachments/assets/e07f046d-8e54-495e-a4d6-470075868a28" />

This is a simple algorithm, but a bit of a pain in the field.

This PWA uses the phone's location services to determine your zone and offset, and using the date gives you the correct shooting hours.

Because this is a PWA, the view and logic can be served locally without an active network connection. This is particularly useful out in the field because cell phone coverage tends to be spotty.

If the hunter installs the PWA to their phone, the PWA can provide further utility by sending push notifications at 10, 5, 3, and 1 minute increments before the shooting starts or stops for the day. An active network connection in the field is required for push notifications to work properly. Each device's push notifications are delivered (and retried if failure) using Cloudflare Durable Objects and Workers.

## Development

[Devenv](https://devenv.sh) provides Node.js 26, npm, and Wrangler. Start the development server, production preview, and local alert Worker together.

```sh
devenv up
```

The preview builds when the stack starts. Wrangler runs the Worker and Durable Objects locally. The first run creates a local VAPID key pair in the ignored `worker/.dev.vars` file, and later runs reuse it. [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/)

To send a test notification, keep the local Field Hours app open on a device with notification permission. Run this command in another terminal while the stack is running.

```sh
devenv shell -- test-notification
```

Choose a connected app, enter a message or accept the default, and confirm. The open app displays the notification through its service worker. Use a registered Web Push subscription to test delivery with the app closed.

Use `--event` to preview the notification sent when shooting hours start or end. The preview uses a sample Central time for Northern Zone A. If the production preview was already running when the app changed, run `npm run build` and reopen Field Hours to load the updated build.

```sh
devenv shell -- test-notification --event opening
devenv shell -- test-notification --event closing
```

## Disclaimer

This project is not affiliated with the Wisconsin DNR.
