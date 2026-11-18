# Field Hours

Field Hours looks up Wisconsin DNR deer shooting hours for a date and shooting hours zone. The app runs in the browser. It uses the phone’s location on request and saves the selected county, area, and zone on that device. Coordinates are used in memory during the session.

## Run locally

Run `devenv shell` to get Node.js 26 (with npm) and Python 3. You can also run the commands directly with Node.js 22 or later and Python 3 installed.

```sh
npm run dev
npm test
```

In IntelliJ IDEA, select **Preview (devenv)** or **Tests (devenv)** in the run configuration dropdown.

Open [the local preview](http://127.0.0.1:4173/). Browsers allow service workers and geolocation on loopback for development. Use HTTPS when testing on a phone.

## Deploy to Cloudflare Pages

Run `npm run build`. The output is `dist/`. For a Git-integrated Pages project, use `npm run build` as the build command and `dist` as the build output directory. Set the Cloudflare project’s Node version to at least 22. [Cloudflare Pages static HTML guide](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

For a Direct Upload project, upload `dist/` from the Cloudflare dashboard or run the following with an authenticated Wrangler session and your Pages project name. [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

```sh
npm run build
npx wrangler pages deploy dist --project-name=YOUR_PROJECT_NAME
```

## Use it in the field

Open the HTTPS site while connected. On iPhone, use Safari’s Share menu and tap **Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home screen**. Open the installed app, wait for **Ready offline**, and set your hunt location. Try reopening it in airplane mode before leaving. If the phone can’t get a GPS fix, the saved zone and the manual picker work offline. The browser can remove downloaded data when site storage is cleared.

If GPS is near a boundary, confirm the zone using the DNR map and choose the area and zone manually. Times are shown in Wisconsin Central time as published in the tables. Check the applicable season dates, equipment rules, and local restrictions for the hunt. [DNR deer regulations](https://dnr.wisconsin.gov/topic/hunt/deer)

## Data and yearly updates

- The bundled schedule covers **September 1, 2026 through January 31, 2027**. The four numbers in each row of `public/assets/hours-data.js` are the Zone A northern opening and closing times, then the southern opening and closing times, in minutes after local midnight. The September through December rows come from the DNR’s [2026 northern table](https://widnr.widen.net/s/bvx8m7fx5b/2026-northern-region-deer-bear-small-game-fall-turkey-shooting-hours) and [2026 southern table](https://widnr.widen.net/s/shjqwrlp8b/2026-southern-region-deer-bear-small-game-fall-turkey-shooting-hours). January 2027 uses the [published pamphlet transcription](https://statehuntingspots.com/wisconsin/legal-shooting-hours/), which cites pages 30–31 of the [2026–27 DNR regulations](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations).
- The app applies the zone’s 0–20 minute offset to both times. The northern and southern areas follow Wis. Admin. Code NR 10.06(2)(a). The app uses the Wisconsin subset of the U.S. Census county polygons [distributed by Plotly](https://github.com/plotly/datasets/blob/master/geojson-counties-fips.json), with a 2 km buffer around the mapped county edges plus the reported GPS uncertainty. [Wisconsin DNR shooting hours method and map](https://dnr.wisconsin.gov/topic/Hunt/regulations/OnlineHuntingRegulations/ShootingHoursCalculatingShootingHours)
- For a new season, replace the schedule with the published times, confirm the area and longitude rules, and update the source links and test fixtures. Run `npm test`, then deploy `dist/`. The build versions the entire offline cache. The new cache takes effect after the old app’s open windows close. Hours outside the bundled date range appear as unavailable.
