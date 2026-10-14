// index.js — PebbleKit JS
console.log("Analogue Time Arc PebbleKit JS (Clay) loaded");

var MAX_CALENDARS = 10;

// Keep the original "calendarConfig" schema: weather, calendar fetching and
// the watch-side C renderer already consume these exact names/indices.
// Clay stores its form state separately under "clay-settings".
var clay = null;

function ensureClay() {
    if (clay) return clay;
    // A broken or missing optional settings package must not block the normal
    // PebbleKit startup, calendar fetching or weather updates.
    var Clay = require('@rebble/clay');
    var claySchema = require('./config');
    clay = new Clay(claySchema, null, { autoHandleEvents: false });
    return clay;
}
var DEFAULT_CAL_COLORS = [0, 4, 8, 2, 9, 5, 1, 7, 10, 3];

function loadSavedConfig() {
    try {
        var value = JSON.parse(localStorage.getItem('calendarConfig') || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) {
        console.log('Invalid saved watchface config: ' + e);
        return {};
    }
}

function validOption(value, fallback, max) {
    var number = Number(value);
    return isFinite(number) && Math.floor(number) === number && number >= 0 && number <= max
        ? number : fallback;
}

var COLOR_HEX = ["00FFAA","55FF00","00FFFF","0055FF","AAAAFF","AA00FF","FF55FF","FF0000","FF5555","FFAA00","FFFF00","FFFFFF","AAAAAA","555555","5500AA","00FF00"];
function colorIndexToHex(value, fallback) {
    return COLOR_HEX[validOption(value, fallback, 15)];
}
function colorHexToIndex(value, fallback) {
    // Clay's color picker serializes the 24-bit RGB color as a decimal
    // number: red is 0xFF0000 (16711680), not a Pebble ARGB8 byte.
    // Saved legacy palette indices (0..15) remain accepted.
    if (typeof value === 'number') {
        if (!isFinite(value) || Math.floor(value) !== value) return fallback;
        if (value >= 0 && value < COLOR_HEX.length) return value;
        if (value >= 0 && value <= 0xFFFFFF) {
            var rgb = ('000000' + value.toString(16)).slice(-6).toUpperCase();
            var matched = COLOR_HEX.indexOf(rgb);
            return matched >= 0 ? matched : fallback;
        }
        return fallback;
    }

    var raw = String(value == null ? '' : value).trim();
    // Strings from a color component are hexadecimal RGB, including strings
    // comprised only of digits (e.g. "555555").
    var hex = raw.replace(/^#|^0x/i, '').toUpperCase();
    var idx = COLOR_HEX.indexOf(hex);
    if (idx >= 0) return idx;
    if (/^\\d{1,2}$/.test(raw)) return validOption(raw, fallback, 15);
    return fallback;
}

function slotOption(value, fallback) {
    return validOption(value, fallback, 6);
}
function migrationSlot(config, slot, defaultValue) {
    if (Object.prototype.hasOwnProperty.call(config, slot)) return slotOption(config[slot], defaultValue);
    if (slot === 'leftComplication') return config.showDate === false ? 0 : 1;
    if (slot === 'topComplication') return Number(config.batteryDisplayMode) === -1 ? 0 : 2;
    return 3;
}
function batteryMode(value, fallback) {
    var n = Number(value);
    return (n === -1 || n === 0 || n === 10 || n === 20 ||
            n === 25 || n === 50) ? n : fallback;
}

function legacyToClay(config) {
    var result = {
        TemperatureUnit: !!config.useFahrenheit,
        LeftComplication: String(migrationSlot(config, 'leftComplication', 1)),
        RightComplication: String(migrationSlot(config, 'rightComplication', 3)),
        TopComplication: String(migrationSlot(config, 'topComplication', 2)),
        ShowTicks: config.showTicks !== false,
        ShowSeconds: config.showSeconds !== false,
        OverlayAboveHands: config.overlayAboveHands === true,
        BatteryDisplayMode: String(batteryMode(config.batteryDisplayMode,
            config.batteryWarningOnly !== false ? 20 : 0)),
        HourHandColor: colorIndexToHex(config.hourColor, 11),
        MinuteHandColor: colorIndexToHex(config.minuteColor, 11),
        TickColor: colorIndexToHex(config.tickColor, 11),
        CenterColor: colorIndexToHex(config.centerColor, 11),
        SecondsColor: colorIndexToHex(config.secondsColor, 7),
        SecondsThickness: String(validOption(config.secondsThickness, 1, 3) || 1),
        HourHandStyle: String(validOption(config.hourHandStyle, 0, 1)),
        MinuteHandStyle: String(validOption(config.minuteHandStyle, 0, 2)),
        HourHandLength: String(validOption(config.hourHandLength, 0, 2)),
        MinuteHandLength: String(validOption(config.minuteHandLength, 0, 2)),
        ShowNextLocation: true,
        LocationPrefix: config.locationPrefix == null ? 'Ort: ' : String(config.locationPrefix)
    };
    for (var i = 0; i < MAX_CALENDARS; i++) {
        result['Calendar' + i + 'Label'] = config['label' + i] || '';
        result['Calendar' + i + 'Url'] = config['url' + i] || '';
        result['Calendar' + i + 'Color'] =
            colorIndexToHex(config['color' + i], DEFAULT_CAL_COLORS[i]);
    }
    return result;
}

function clayValue(settings, key, fallback) {
    var item = settings[key];
    if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value')) {
        return item.value;
    }
    return fallback;
}

function clayToLegacy(settings, previous) {
    // Do not discard unrecognized fields stored by older/newer versions.
    var config = previous;
    config.useFahrenheit = !!clayValue(settings, 'TemperatureUnit', false);
    config.leftComplication = slotOption(clayValue(settings, 'LeftComplication',
        migrationSlot(config,'leftComplication',1)), 1);
    config.rightComplication = slotOption(clayValue(settings, 'RightComplication',
        migrationSlot(config,'rightComplication',3)), 3);
    config.topComplication = slotOption(clayValue(settings, 'TopComplication',
        migrationSlot(config,'topComplication',2)), 2);
    config.showTicks = !!clayValue(settings, 'ShowTicks', true);
    config.showSeconds = !!clayValue(settings, 'ShowSeconds', true);
    config.overlayAboveHands = !!clayValue(settings, 'OverlayAboveHands', false);
    config.batteryDisplayMode = batteryMode(clayValue(settings, 'BatteryDisplayMode',
        config.batteryWarningOnly !== false ? 20 : 0), 20);
    config.hourColor = colorHexToIndex(clayValue(settings, 'HourHandColor', colorIndexToHex(config.hourColor, 11)), 11);
    config.minuteColor = colorHexToIndex(clayValue(settings, 'MinuteHandColor', colorIndexToHex(config.minuteColor, 11)), 11);
    config.tickColor = colorHexToIndex(clayValue(settings, 'TickColor', colorIndexToHex(config.tickColor, 11)), 11);
    config.centerColor = colorHexToIndex(clayValue(settings, 'CenterColor', colorIndexToHex(config.centerColor, 11)), 11);
    config.secondsColor = colorHexToIndex(clayValue(settings, 'SecondsColor', colorIndexToHex(config.secondsColor, 7)), 7);
    config.secondsThickness = validOption(clayValue(settings, 'SecondsThickness', config.secondsThickness || 1), 1, 3) || 1;
    config.hourHandStyle = validOption(clayValue(settings, 'HourHandStyle', 0), 0, 1);
    config.minuteHandStyle = validOption(clayValue(settings, 'MinuteHandStyle', 0), 0, 2);
    config.hourHandLength = validOption(clayValue(settings, 'HourHandLength', 0), 0, 2);
    config.minuteHandLength = validOption(clayValue(settings, 'MinuteHandLength', 0), 0, 2);
    config.showNextLocation = true;
    config.locationPrefix = String(clayValue(settings, 'LocationPrefix',
        config.locationPrefix == null ? 'Ort: ' : config.locationPrefix)).substring(0, 20);

    for (var i = 0; i < MAX_CALENDARS; i++) {
        var label = clayValue(settings, 'Calendar' + i + 'Label', '');
        var url = clayValue(settings, 'Calendar' + i + 'Url', '');
        config['label' + i] = String(label == null ? '' : label).trim();
        config['url' + i] = String(url == null ? '' : url).trim();
        config['color' + i] = colorHexToIndex(
            clayValue(settings, 'Calendar' + i + 'Color',
                colorIndexToHex(config['color' + i], DEFAULT_CAL_COLORS[i])),
            DEFAULT_CAL_COLORS[i]);
    }
    return config;
}

// Cached geolocation position
var s_last_lat = null;
var s_last_lng = null;

// ─── Weather ──────────────────────────────────────────────────────────────────

function fetchWeather(latitude, longitude, useFahrenheit) {
    var unit = useFahrenheit ? "fahrenheit" : "celsius";
    var url = "https://api.open-meteo.com/v1/forecast"
        + "?latitude=" + latitude
        + "&longitude=" + longitude
        + "&current=temperature_2m,weather_code"
        + "&temperature_unit=" + unit;

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var data = JSON.parse(xhr.responseText);
                var temp = Math.round(data.current.temperature_2m);
                var code = data.current.weather_code;
                console.log("Weather: " + temp + "° code=" + code);
                Pebble.sendAppMessage({ 6: temp, 7: code }, function() {
                    console.log("Weather sent");
                }, function(e) {
                    console.log("Weather send failed: " + JSON.stringify(e));
                });
            } catch (e) { console.log("Weather parse error: " + e); }
        }
    };
    xhr.send();
}

// ─── ICS Parsing ─────────────────────────────────────────────────────────────

function parseICSDate(str) {
    if (!str) return null;
    str = str.replace(/^TZID=[^:]+:/, "");
    var basic = str.replace(/[-:]/g, "");
    var year   = parseInt(basic.substring(0, 4), 10);
    var month  = parseInt(basic.substring(4, 6), 10) - 1;
    var day    = parseInt(basic.substring(6, 8), 10);
    var hour   = basic.length >= 13 ? parseInt(basic.substring(9, 11), 10) : 0;
    var minute = basic.length >= 13 ? parseInt(basic.substring(11, 13), 10) : 0;
    var second = basic.length >= 15 ? parseInt(basic.substring(13, 15), 10) : 0;
    var isUTC  = str.charAt(str.length - 1) === "Z";
    return isUTC
        ? new Date(Date.UTC(year, month, day, hour, minute, second))
        : new Date(year, month, day, hour, minute, second);
}

function unfoldICS(raw) {
    return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseDuration(str) {
    var ms = 0;
    var weeks   = str.match(/(\d+)W/);
    var days    = str.match(/(\d+)D/);
    var hours   = str.match(/(\d+)H/);
    var minutes = str.match(/(\d+)M/);
    var seconds = str.match(/(\d+)S/);
    if (weeks)   ms += parseInt(weeks[1],   10) * 7 * 24 * 60 * 60 * 1000;
    if (days)    ms += parseInt(days[1],    10) * 24 * 60 * 60 * 1000;
    if (hours)   ms += parseInt(hours[1],   10) * 60 * 60 * 1000;
    if (minutes) ms += parseInt(minutes[1], 10) * 60 * 1000;
    if (seconds) ms += parseInt(seconds[1], 10) * 1000;
    return ms;
}

// ─── RRULE parsing ───────────────────────────────────────────────────────────
// Supports FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY.
// Returns an array of occurrence start Dates within [now, cutoff].

var BYDAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(rruleStr) {
    var rule = {};
    var parts = rruleStr.split(";");
    for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf("=");
        if (eq < 0) continue;
        var k = parts[i].substring(0, eq).toUpperCase();
        var v = parts[i].substring(eq + 1);
        rule[k] = v;
    }
    return rule;
}

// Returns midnight (local) of the date represented by a Date object
function dateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Add calendar months safely (handles month-end overflow by clamping)
function addMonths(d, n) {
    var result = new Date(d.getTime());
    var day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + n);
    var maxDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, maxDay));
    return result;
}

function expandRRule(dtstart, rruleStr, now, cutoff) {
    var rule     = parseRRule(rruleStr);
    var freq     = rule.FREQ || "";
    var interval = rule.INTERVAL ? parseInt(rule.INTERVAL, 10) : 1;
    var count    = rule.COUNT    ? parseInt(rule.COUNT,    10) : -1;
    var until    = rule.UNTIL    ? parseICSDate(rule.UNTIL) : null;
    var occurrences = [];

    // BYDAY: array of day-of-week numbers (0=Sun..6=Sat)
    var byDay = [];
    if (rule.BYDAY) {
        var dayTokens = rule.BYDAY.split(",");
        for (var d = 0; d < dayTokens.length; d++) {
            // Strip optional ordinal prefix e.g. "+1MO" -> "MO"
            var token = dayTokens[d].replace(/^[+-]?\d*/, "").toUpperCase();
            if (BYDAY_MAP.hasOwnProperty(token)) byDay.push(BYDAY_MAP[token]);
        }
    }

    // Hard cap: never iterate more than 500 steps to protect against
    // runaway loops on very old recurring events with no UNTIL/COUNT.
    var MAX_ITER = 500;
    var iter     = 0;
    var cursor   = new Date(dtstart.getTime());

    while (iter++ < MAX_ITER) {
        // Stop if we have gone past cutoff or hit UNTIL
        if (cursor > cutoff) break;
        if (until && cursor > until) break;
        if (count === 0) break;

        if (freq === "WEEKLY" && byDay.length > 0) {
            // For weekly+BYDAY, check each day of the current week
            // (week starting on the same weekday as dtstart to honour WKST=MO etc.)
            // Simpler: just check all 7 days of the ISO week containing cursor.
            var weekStart = new Date(cursor.getTime());
            weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday
            for (var wd = 0; wd < 7; wd++) {
                var candidate = new Date(weekStart.getFullYear(),
                                         weekStart.getMonth(),
                                         weekStart.getDate() + wd,
                                         dtstart.getHours(),
                                         dtstart.getMinutes(),
                                         dtstart.getSeconds());
                if (candidate < dtstart) continue;       // before series start
                if (until && candidate > until) continue;
                if (candidate > cutoff) continue;
                var inByDay = false;
                for (var b = 0; b < byDay.length; b++) {
                    if (candidate.getDay() === byDay[b]) { inByDay = true; break; }
                }
                if (!inByDay) continue;
                if (candidate >= now) {
                    occurrences.push(new Date(candidate.getTime()));
                    if (count > 0 && --count === 0) break;
                }
            }
            // Advance cursor by interval weeks
            cursor.setDate(cursor.getDate() + 7 * interval);

        } else {
            // Simple case: one occurrence per step
            if (cursor >= now) {
                occurrences.push(new Date(cursor.getTime()));
                if (count > 0 && --count === 0) break;
            }
            if (freq === "DAILY") {
                cursor.setDate(cursor.getDate() + interval);
            } else if (freq === "WEEKLY") {
                cursor.setDate(cursor.getDate() + 7 * interval);
            } else if (freq === "MONTHLY") {
                cursor = addMonths(cursor, interval);
            } else if (freq === "YEARLY") {
                cursor = addMonths(cursor, 12 * interval);
            } else {
                break; // unknown freq
            }
        }
    }

    return occurrences;
}

// Convert a Date+duration into an arc event and push if it falls in window
function pushArcEvent(events, calendarIndex, start, durationMs, now, cutoff, title, allDay, location) {
    var end = new Date(start.getTime() + durationMs);
    if (end <= now || start >= cutoff) return;

    // Calendar arcs are anchored to today's 12-hour dial. An appointment
    // starting tomorrow can have exactly the same dial angle as "now" and
    // must not masquerade as an event occurring today. Retain overnight
    // events that began yesterday and are still active.
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (start >= midnight) return;
    // Retain the label in the meeting list, but do not draw an all-day arc.
    if (allDay) {
        events.push({ calIndex: calendarIndex, startMins: 0, durationMins: 0,
                      title: title || "", allDay: true, location: location || "",
                      startTime: start.getTime(), endTime: end.getTime(), fullStartMins: 0 });
        return;
    }
    var startMins    = (start.getHours() * 60 + start.getMinutes()) % 720;
    var endMins      = (end.getHours()   * 60 + end.getMinutes())   % 720;
    var durationMins = endMins - startMins;
    if (durationMins <= 0) durationMins += 720;
    durationMins = Math.min(durationMins, 720);
    if (durationMins > 0) {
        events.push({ calIndex: calendarIndex, startMins: startMins, durationMins: durationMins,
                      title: title || "", allDay: false, location: location || "",
                      startTime: start.getTime(), endTime: end.getTime(),
                      fullStartMins: start.getHours() * 60 + start.getMinutes() });
    }
}

function unescapeICSText(value) {
    // ICS escapes: \n (line break), \, \; and \\.
    return (value || "").replace(/\\[nN]/g, " ").replace(/\\([,;\\])/g, "$1");
}

function parseICS(raw, calendarIndex, now, cutoff) {
    var text = unfoldICS(raw);
    var lines = text.split(/\r?\n/);

    var events = [];

    var inEvent = false;
    var current = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        // ─── State transitions ─────────────────────────────
        if (line === "BEGIN:VEVENT") {
            inEvent = true;
            current = {
                dtstart: null,
                dtend: null,
                isAllDay: false,
                duration: null,
                rrule: null,
                exdates: {},
                summary: "",
                location: ""
            };
            continue;
        }

        if (line === "END:VEVENT") {
            if (current && current.dtstart) {
                var start = current.dtstart;
                var durationMs;

                if (current.dtend) {
                    durationMs = current.dtend.getTime() - start.getTime();
                } else if (current.duration) {
                    durationMs = current.duration;
                } else {
                    durationMs = current.isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
                }

                // Some ICS producers represent all-day entries with midnight
                // DATE-TIME values instead of VALUE=DATE. Detect those too.
                if (!current.isAllDay) {
                    var effectiveEnd = new Date(start.getTime() + durationMs);
                    current.isAllDay =
                        start.getHours() === 0 && start.getMinutes() === 0 &&
                        start.getSeconds() === 0 &&
                        effectiveEnd.getHours() === 0 && effectiveEnd.getMinutes() === 0 &&
                        effectiveEnd.getSeconds() === 0 &&
                        dateOnly(effectiveEnd).getTime() > dateOnly(start).getTime();
                }

                if (current.rrule) {
                    var occurrences = expandRRule(start, current.rrule,
                                                   new Date(now.getTime() - durationMs), cutoff);

                    for (var o = 0; o < occurrences.length; o++) {
                        var occ = occurrences[o];

                        var key = dateOnly(occ).getTime();
                        if (current.exdates[key]) continue;

                        pushArcEvent(
                            events,
                            calendarIndex,
                            occ,
                            durationMs,
                            now,
                            cutoff,
                            current.summary,
                            current.isAllDay,
                            current.location
                        );
                    }
                } else {
                    pushArcEvent(
                        events,
                        calendarIndex,
                        start,
                        durationMs,
                        now,
                        cutoff,
                        current.summary,
                        current.isAllDay,
                        current.location
                    );
                }
            }

            inEvent = false;
            current = null;
            continue;
        }

        // ─── Ignore everything outside VEVENT ───────────────
        if (!inEvent || !current) continue;

        // ─── Key/Value parsing ──────────────────────────────
        var colonIdx = line.indexOf(":");
        if (colonIdx < 0) continue;

        var rawKey = line.substring(0, colonIdx);
        var key = rawKey.toUpperCase().split(";")[0];
        var value = line.substring(colonIdx + 1);

        // ─── Property handling ──────────────────────────────
        if (key === "DTSTART") {
            current.dtstart = parseICSDate(value);
            current.isAllDay = /(?:^|;)VALUE=DATE(?:;|$)/i.test(rawKey) ||
                               /^\d{8}$/.test(value.trim());
        }

        else if (key === "DTEND") {
            current.dtend = parseICSDate(value);
        }

        else if (key === "DURATION") {
            current.duration = parseDuration(value);
        }

        else if (key === "RRULE") {
            current.rrule = value;
        }

        else if (key === "SUMMARY") {
            current.summary = unescapeICSText(value);
        }

        else if (key === "LOCATION") {
            current.location = unescapeICSText(value);
        }

        else if (key === "EXDATE") {
            var exParts = value.split(",");
            for (var ex = 0; ex < exParts.length; ex++) {
                var exDate = parseICSDate(exParts[ex].trim());
                if (exDate) {
                    current.exdates[dateOnly(exDate).getTime()] = true;
                }
            }
        }
    }

    return events;
}

// ─── Send display settings ────────────────────────────────────────────────────

function sendDisplaySettings() {
    var config = JSON.parse(localStorage.getItem("calendarConfig") || "{}");

    var defaults = [0, 4, 8, 2, 9, 5, 1, 7, 10, 3];
    var colors = [];
    for (var i = 0; i < MAX_CALENDARS; i++) {
        var key = "color" + i;
        colors.push(typeof config[key] === "number" ? config[key] : defaults[i]);
    }
    var packedColors = colors.join(",");

    var msg = {
        2:  config.useFahrenheit ? 1 : 0,
        3:  migrationSlot(config, 'leftComplication', 1) === 1 ? 1 : 0,
        67: migrationSlot(config, 'leftComplication', 1),
        68: migrationSlot(config, 'rightComplication', 3),
        69: migrationSlot(config, 'topComplication', 2),
        8:  (config.showTicks !== false) ? 1 : 0,
        12: typeof config.hourColor === "number" ? config.hourColor : 11,
        13: packedColors,
        14: typeof config.minuteColor === "number" ? config.minuteColor : 11,
        62: validOption(config.tickColor, 11, 15),
        63: validOption(config.centerColor, 11, 15),
        64: validOption(config.secondsColor, 7, 15),
        65: validOption(config.secondsThickness, 1, 3) || 1,
        66: (config.locationPrefix == null ? 'Ort: ' : String(config.locationPrefix)).substring(0, 20),
        21: (config.showSeconds !== false) ? 1 : 0,
        60: batteryMode(config.batteryDisplayMode,
              config.batteryWarningOnly !== false ? 20 : 0),
        23: config.overlayAboveHands ? 1 : 0,
        24: config.hourHandStyle === 1 ? 1 : 0,
        25: (config.minuteHandStyle === 1 || config.minuteHandStyle === 2)
                ? config.minuteHandStyle : 0,
        56: validOption(config.hourHandLength, 0, 2),
        57: validOption(config.minuteHandLength, 0, 2),
    };
    Pebble.sendAppMessage(msg, function() {
        console.log("Display settings sent: " + JSON.stringify(msg));
    }, function(e) {
        console.log("Display settings send failed: " + JSON.stringify(e));
    });
}

// ─── Event-location priority window ─────────────────────────────────────────
var s_last_location_events = [];
var s_last_location_sent = null;

function currentLocationState(now) {
    var timestamp = now.getTime();
    var windowMs = 15 * 60 * 1000;
    var timed = s_last_location_events.filter(function(event) {
        return !!event.location && event.endTime > timestamp;
    });
    // Use the current appointment, otherwise the next upcoming appointment.
    timed.sort(function(a, b) {
        var aActive = a.startTime <= timestamp;
        var bActive = b.startTime <= timestamp;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return a.startTime - b.startTime;
    });
    var event = timed.length ? timed[0] : null;
    if (!event) return { location: "", priority: 0 };
    return {
        location: event.location.substring(0, 80),
        priority: timestamp >= event.startTime - windowMs &&
                  timestamp < event.startTime + windowMs ? 1 : 0
    };
}

function refreshPriorityLocation() {
    var state = currentLocationState(new Date());
    var cacheKey = state.priority + "|" + state.location;
    if (cacheKey === s_last_location_sent) return;
    Pebble.sendAppMessage({59: state.location, 61: state.priority}, function() {
        s_last_location_sent = cacheKey;
        console.log("Appointment location: " + (state.location || "(none)") +
                    ", priority=" + state.priority);
    }, function(err) {
        console.log("Location update failed: " + JSON.stringify(err));
        s_last_location_sent = null;
    });
}

// ─── Send events ─────────────────────────────────────────────────────────────

function sendEventsToWatch(events) {

    var now = new Date();

    var nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Ongoing timed events first, then upcoming starts; all-day notes last.
    events.sort(function(a, b) {
        if (!!a.allDay !== !!b.allDay) return a.allDay ? 1 : -1;
        var aActive = !a.allDay && a.startTime <= now.getTime() &&
                      a.endTime > now.getTime();
        var bActive = !b.allDay && b.startTime <= now.getTime() &&
                      b.endTime > now.getTime();
        if (aActive !== bActive) return aActive ? -1 : 1;
        return (a.startTime || 0) - (b.startTime || 0);
    });

    // Store appointments for the priority window: 15 minutes before until
    // 15 minutes after the start. Re-evaluate once per minute without refetching.
    s_last_location_events = events.filter(function(event) {
        return !event.allDay && !!event.startTime;
    });
    var locationState = currentLocationState(now);

    events = events.slice(0, 10);

    var packed = events.map(function(e) {
        return e.startMins + "," + e.durationMins + "," + e.calIndex + "," +
               (e.allDay ? 1 : 0) + "," + (e.fullStartMins == null ? e.startMins : e.fullStartMins);
    }).join("|");

    var next = events.slice(0, 3);

    var msg = {

        5: packed,

        15: next[0] && next[0].title ? next[0].title.substring(0, 28) : "",
        16: next[1] && next[1].title ? next[1].title.substring(0, 28) : "",
        17: next[2] && next[2].title ? next[2].title.substring(0, 28) : "",

        18: next[0] ? next[0].calIndex : 0,
        19: next[1] ? next[1].calIndex : 0,
        20: next[2] ? next[2].calIndex : 0,
        59: locationState.location,
        61: locationState.priority
    };

    s_last_location_sent = null; // Keep retries available if the combined packet fails.
    console.log("Sending " + events.length + " events: " + packed);

    Pebble.sendAppMessage(msg,
        function() {
            console.log("Events sent");
        },
        function(e) {
            console.log("Send failed: " + JSON.stringify(e));
        }
    );
}

// ─── Fetch calendars ──────────────────────────────────────────────────────────

// Track consecutive failures per calendar slot to avoid hammering dead URLs
var s_cal_fail_count = [0,0,0,0,0,0,0,0,0,0];
var MAX_FAIL_COUNT = 3;

function fetchCalendar(url, calendarIndex, now, cutoff, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                s_cal_fail_count[calendarIndex] = 0; // reset on success
                callback(null, parseICS(xhr.responseText, calendarIndex, now, cutoff));
            } catch (e) {
                console.log("ICS parse error cal " + calendarIndex + ": " + e);
                s_cal_fail_count[calendarIndex]++;
                callback(e, []);
            }
        } else {
            console.log("HTTP " + xhr.status + " for cal " + calendarIndex);
            s_cal_fail_count[calendarIndex]++;
            callback(new Error("HTTP " + xhr.status), []);
        }
    };
    xhr.onerror = function() {
        s_cal_fail_count[calendarIndex]++;
        callback(new Error("Network error"), []);
    };
    xhr.send();
}

function fetchAllCalendars() {
    var config = JSON.parse(localStorage.getItem("calendarConfig") || "{}");

    var entries = [];
    for (var i = 0; i < MAX_CALENDARS; i++) {
        var url = config["url" + i] || "";
        if (url.length > 0) {
            if (s_cal_fail_count[i] >= MAX_FAIL_COUNT) {
                console.log("Skipping cal " + i + " after " + s_cal_fail_count[i] + " failures");
                continue;
            }
            entries.push({ url: url, idx: i });
        }
    }

    if (entries.length === 0) {
        console.log("No calendar URLs to fetch");
        sendEventsToWatch([]);
        return;
    }

    var now    = new Date();
    var horizon = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var cutoff = horizon < tomorrow ? horizon : tomorrow;
    console.log("Fetching " + entries.length + " calendars");

    var allEvents = [], pending = entries.length;
    entries.forEach(function(entry) {
        fetchCalendar(entry.url, entry.idx, now, cutoff, function(err, events) {
            if (!err) allEvents = allEvents.concat(events);
            if (--pending === 0) sendEventsToWatch(allEvents);
        });
    });
}

// ─── Combined refresh (weather + calendars) ───────────────────────────────────

function refreshWeather(cfg) {
    navigator.geolocation.getCurrentPosition(function(pos) {
        s_last_lat = pos.coords.latitude;
        s_last_lng = pos.coords.longitude;
        fetchWeather(s_last_lat, s_last_lng, cfg.useFahrenheit || false);
    }, function(err) {
        console.log("Geolocation error: " + err.message);
        // Fall back to cached position if available
        if (s_last_lat !== null) {
            console.log("Using cached position");
            fetchWeather(s_last_lat, s_last_lng, cfg.useFahrenheit || false);
        }
    }, {
        timeout: 10000,
        maximumAge: 60 * 60 * 1000  // accept a cached position up to 1 hour old
    });
}

function refreshAll() {
    var cfg = JSON.parse(localStorage.getItem("calendarConfig") || "{}");
    refreshWeather(cfg);
    fetchAllCalendars();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

Pebble.addEventListener("ready", function() {
    console.log("PebbleKit JS ready");

    var config = JSON.parse(localStorage.getItem("calendarConfig") || "{}");
    sendDisplaySettings();
    refreshWeather(config);
    fetchAllCalendars();

    // Single consolidated interval: weather + calendars every 60 minutes
    setInterval(refreshAll, 60 * 60 * 1000);
    setInterval(refreshPriorityLocation, 60 * 1000);
});

Pebble.addEventListener("showConfiguration", function() {
    try {
        var settingsPage = ensureClay();
        // Load previously saved watchface settings, including all 10 ICS URLs.
        // The Clay settings page is bundled locally; no external hosting is used.
        if (localStorage.getItem('calendarConfig') !== null) {
            settingsPage.setSettings(legacyToClay(loadSavedConfig()));
        }
        Pebble.openURL(settingsPage.generateUrl());
    } catch (err) {
        console.log('Cannot open Clay settings: ' + err);
    }
});

Pebble.addEventListener("webviewclosed", function(e) {
    if (!e || !e.response || e.response === "CANCELLED") return;

    try {
        // Suppress Clay's default bulk AppMessage: the C watchface only needs
        // the compact legacy messages, especially the packed calendar colors.
        var settings = ensureClay().getSettings(e.response, false);
        var config = clayToLegacy(settings, loadSavedConfig());
        localStorage.setItem('calendarConfig', JSON.stringify(config));
        console.log('Clay config saved');
        // Newly configured ICS URLs should not inherit fetch failure counts.
        s_cal_fail_count = [0,0,0,0,0,0,0,0,0,0];
        sendDisplaySettings();
        refreshWeather(config);
        fetchAllCalendars();
        refreshPriorityLocation();
    } catch (err) {
        console.log('Failed to parse Clay response: ' + err);
    }
});