# Analogue Time Arc

A Pebble analogue watchface with ICS calendar arcs, weather and independently configurable hour and minute hands.

## Calendar events

Timed events are displayed as arcs around the 12-hour dial. Date-only ICS events (`DTSTART;VALUE=DATE`), including recurring all-day events, are kept as text entries but **do not draw arcs**. In the text list, such entries appear as `All day: <title>`.

## Hand styles

Choose hour and minute hand styles independently in the [companion configuration page](https://protarios.github.io/pebble-analogue-config/):

- **Classic** (default): original 5-pixel hour and 3-pixel minute hands.
- **Minimalin**: thick, short hands inspired by Minimalin Reborn (8 px on the Pebble Time 2, 6 px on round platforms).
- **Minimalin Rainbow** (minute only): the actual Minimalin Reborn rainbow hand, rotated about its original pivot.

The selected styles are transferred with app message keys 24 (hour) and 25 (minute). Older configurations without these keys continue to use the original appearance.

The Minimalin graphics and styling were adapted from [minimalin-reborn](https://github.com/Protarios/minimalin-reborn), MIT licensed. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
