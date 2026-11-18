# Field Hours

Field Hours shows today’s Wisconsin DNR deer shooting hours for the selected area and longitude zone. The map and hours work in the browser. **Use my location** requests a fix and marks it with a blue dot and accuracy ring, including when you need to confirm the zone manually. The app saves the selected area and zone on the device. Coordinates stay in memory during the session.

## Run locally

The devenv shell provides Node.js 26, npm, and Wrangler. It installs dependencies from `package-lock.json` when you enter the shell.

```sh
devenv shell
npm run dev
```

With a standalone installation of Node.js 22.18+ on the 22.x line, Node.js 24.x, or Node.js 26 and later, run `npm ci` before `npm run dev`.

In IntelliJ IDEA, run **Dev** to start the same server through devenv. Open [the development server](http://127.0.0.1:5173/) and leave it open to see changes as you save.

To test offline access, build and serve the production output.

```sh
npm run build
npm run preview
```

Open [the production preview](http://127.0.0.1:4173/). Browsers allow service workers and geolocation on loopback for development. Use HTTPS when testing on a phone.

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

## Use it in the field

Open the HTTPS site while connected. On iPhone, use Safari’s Share menu and tap **Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home screen**. Open the installed app while online and set your hunt location. Try reopening it in airplane mode before leaving. If the phone can’t get a GPS fix, the saved zone and the manual picker work offline. The browser can remove downloaded data when site storage is cleared.

If GPS is near a boundary, confirm the zone using the DNR map and choose the area and zone manually. Times are shown in Wisconsin Central time as published in the tables. Check the applicable season dates, equipment rules, and local restrictions for the hunt. [DNR deer regulations](https://dnr.wisconsin.gov/topic/hunt/deer)

## Data and yearly updates

- The bundled schedule covers **September 1, 2026 through January 31, 2027**. Each row of `src/hours-data.ts` lists the Zone A northern opening and closing times, then the southern opening and closing times, in minutes after local midnight. All rows match page 31 of the printed regulations. [2026–27 Wisconsin DNR regulations](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations)
- The app uses the location’s Northern or Southern area to choose the Zone A table, then adds the longitude zone’s 0–20 minute offset to both times. [Wisconsin DNR shooting hours method and map](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations/ShootingHoursCalculatingShootingHours)
- The map and location lookup use area outlines created by joining the U.S. Census county polygons within each area as defined by Wis. Admin. Code NR 10.06(2)(a). The map draws thin county lines for reference. The lookup allows a 2 km margin for generalized area outlines in addition to the reported GPS uncertainty. [Census polygons distributed by Plotly](https://github.com/plotly/datasets/blob/master/geojson-counties-fips.json)
- For a new season, replace the schedule with the published times, confirm the area and longitude rules, and update the source links and test fixtures. Open a pull request and verify the checks before merging. The build versions the entire offline cache. The new cache takes effect after the old app’s open windows close. Hours outside the bundled date range appear as unavailable.
