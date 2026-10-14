# Analogue Time Arc

A Pebble analogue watchface with ICS calendar arcs, weather and independently configurable hour and minute hands.

## Calendar events

Timed events are displayed as arcs around the 12-hour dial. Date-only ICS events (`DTSTART;VALUE=DATE`), including recurring all-day events, are kept as text entries but **do not draw arcs**. In the text list, such entries appear as `All day: <title>`.

## Hand styles

Choose hour and minute hand styles independently in the **built-in Clay settings page** (Pebble app → Watchface settings):

- **Classic** (default): original 5-pixel hour and 3-pixel minute hands.
- **Minimalin**: thick, short hands inspired by Minimalin Reborn (8 px on the Pebble Time 2, 6 px on round platforms).
- **Minimalin Rainbow** (minute only): the actual Minimalin Reborn rainbow hand, rotated about its original pivot.

The selected styles are transferred with app message keys 24 (hour) and 25 (minute). Older configurations without these keys continue to use the original appearance.

The Minimalin graphics and styling were adapted from [minimalin-reborn](https://github.com/Protarios/minimalin-reborn), MIT licensed. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Offline configuration with Clay

The settings page is part of the watchface package via [@rebble/clay](https://www.npmjs.com/package/@rebble/clay). **No web server, GitHub Pages or HTML-preview URL is needed.**

The Clay schema is in `src/pkjs/config.js`. It covers six display toggles, both hand styles and colors, plus name, ICS URL and one of the original 16 palette colors for **each of 10 calendars**.

The previous `calendarConfig` values are migrated into Clay when opening settings and preserved on save (including all ICS URLs). The PebbleKit JS continues sending compact existing AppMessages to the watch instead of flooding it with every Clay input. Cancellation leaves saved data unchanged.

Install the Pebble package dependency in your development environment:

```sh
pebble package install @rebble/clay
pebble build
```

The build already bundles `src/pkjs/**/*.js`; `enableMultiJS` is enabled. After installation, open the watchface settings in the Pebble app. The external `pebble-analogue-config` repository is no longer required.

Run the JavaScript regression tests with `npm test` (Node.js). The Pebble SDK/device build must still be verified separately.
