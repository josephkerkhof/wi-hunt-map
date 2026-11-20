# Field Hours

Field Hours shows today’s Wisconsin DNR deer shooting hours for the selected area and longitude zone. The map and hours work in the browser. **Use my location** requests a fix and marks it with a blue dot and accuracy ring, including when you need to confirm the zone manually. The app saves the selected area and zone on the device. Coordinates stay in memory during the session.

## Run locally

Devenv provides Node.js 26, npm, and Wrangler. Start the development server, production preview, and local alert Worker together.

```sh
devenv up
```

In IntelliJ IDEA, run **Dev** to start the same stack. Use [the development server](http://127.0.0.1:5173/) for live editing and [the production preview](http://127.0.0.1:4173/) for installed-app and offline testing. For iPhone Web Push, add Field Hours to the Home Screen and open it there. Use HTTPS to test from a physical phone. [Web Push on iPhone](https://webkit.org/blog/13878/)

The preview builds when the stack starts. Wrangler runs the Worker and Durable Objects locally. The first run creates a local VAPID key pair in the ignored `worker/.dev.vars` file, and later runs reuse it. [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/)

To send a test notification, keep the local Field Hours app open on a device with notification permission. Run this command in another terminal while the stack is running.

```sh
devenv shell -- test-notification
```

Choose a connected app, enter a message or accept the default, and confirm. The open app displays the notification through its service worker. Use a registered Web Push subscription to test delivery with the app closed.

## Check changes

- `npm run check` checks formatting with Oxfmt, runs Oxlint with anti-slop, type-checks the app and worker, and runs Vitest.
- `npm run format` applies formatting. `npm run lint -- --fix` applies available lint fixes.
- `npm test` runs the tests once, including a production build in a temporary directory. IntelliJ IDEA’s **Tests** run configuration runs the same command through devenv. `npm run test:watch` starts Vitest in watch mode.

The anti-slop plugin is vendored with its license and upstream revision. [Vendored plugin](tools/oxlint/anti-slop/UPSTREAM.md)

## Deploy to Cloudflare Pages

The [CI/CD workflow](.github/workflows/ci-cd.yml) runs `npm run check` and `npm run build` on pull requests to `main` and pushes to `main`. After both commands pass on `main`, GitHub Actions uploads the built site to the `wi-hunt-map` Pages project. The production site uses [deer.kerkhof.dev](https://deer.kerkhof.dev/).

Set `CLOUDFLARE_ACCOUNT_ID` as a GitHub Actions repository variable and `CLOUDFLARE_API_TOKEN` as a repository secret. The token needs **Account → Cloudflare Pages → Edit** for the account that owns the Pages project. [Cloudflare Pages deployment credentials](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#get-credentials-from-cloudflare)

To deploy manually from `main`, run these commands in the devenv shell with an authenticated Wrangler session.

```sh
npm run check
npm run build
wrangler pages deploy dist --project-name=wi-hunt-map --branch=main
```

### Deploy the alert Worker

The Worker handles `/api/alerts` on the production hostname. A Durable Object stores each device’s next event and wakes at its reminder times. The Worker and app use the same bundled hours.

1. Generate a dedicated production VAPID key pair with `npm exec -- web-push generate-vapid-keys --json`. Store `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in a private `.env` file outside this repository. Keep the key pair for future deployments so browser subscriptions continue to work.
2. Upload the Worker and its secrets from an authenticated Wrangler session.

   ```sh
   wrangler deploy --config worker/wrangler.jsonc --secrets-file /path/to/production-alerts.env
   ```

3. Set the Actions repository variable `CLOUDFLARE_ALERTS_ENABLED` to `true` to deploy the Worker with future Pages releases. Give `CLOUDFLARE_API_TOKEN` **Account → Workers Scripts → Edit** and **Zone → Workers Routes → Edit** for `kerkhof.dev`. [Cloudflare Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)

For manual releases after setup, run `wrangler deploy --config worker/wrangler.jsonc` before deploying Pages.

## Use it in the field

Open the HTTPS site while connected. On iPhone, use Safari’s Share menu and tap **Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home screen**. Open the installed app while online and set your hunt location. Try reopening it in airplane mode before leaving. If the phone can’t get a GPS fix, the saved zone and the manual picker work offline. The browser can remove downloaded data when site storage is cleared.

To get reminders, open the bell and enable alerts for the opening or closing shown. Field Hours sends any remaining 10-, 5-, 3-, and 1-minute reminders for that event and turns alerts off when it arrives. Each set uses the area and zone you confirmed when enabling it. Push delivery needs a connection. On a paired Apple Watch, notifications follow iPhone mirroring settings. [Apple Watch notifications](https://support.apple.com/en-us/108274)

If GPS is near a boundary, confirm the zone using the DNR map and choose the area and zone manually. Times are shown in Wisconsin Central time as published in the tables. Check the applicable season dates, equipment rules, and local restrictions for the hunt. [DNR deer regulations](https://dnr.wisconsin.gov/topic/hunt/deer)

## Data and yearly updates

- The bundled schedule covers **September 1, 2026 through January 31, 2027**. Each row of `src/hours-data.ts` lists the Zone A northern opening and closing times, then the southern opening and closing times, in minutes after local midnight. All rows match page 31 of the printed regulations. [2026–27 Wisconsin DNR regulations](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations)
- The app uses the location’s Northern or Southern area to choose the Zone A table, then adds the longitude zone’s 0–20 minute offset to both times. [Wisconsin DNR shooting hours method and map](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations/ShootingHoursCalculatingShootingHours)
- The map and location lookup use area outlines created by joining the U.S. Census county polygons within each area as defined by Wis. Admin. Code NR 10.06(2)(a). The map draws thin county lines for reference. The lookup allows a 2 km margin for generalized area outlines in addition to the reported GPS uncertainty. [Census polygons distributed by Plotly](https://github.com/plotly/datasets/blob/master/geojson-counties-fips.json)
- For a new season, replace the schedule with the published times, confirm the area and longitude rules, and update the source links and test fixtures. Open a pull request and verify the checks before merging. The app checks for new builds on launch, on return to the foreground, and when the device reconnects. After downloading the complete build for offline use, it reloads to apply the update. Hours outside the bundled date range appear as unavailable.
