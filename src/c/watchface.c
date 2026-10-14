#include <pebble.h>
#include <limits.h>

#ifndef MIN
#define MIN(a,b) ((a) < (b) ? (a) : (b))
#endif

// --- Message keys ---------------------------------------------
#define KEY_BACKGROUND_COLOR  0
#define KEY_TEXT_COLOR        1
#define KEY_TEMPERATURE_UNIT  2
#define KEY_SHOW_DATE         3
#define KEY_HOUR_FORMAT       4
#define KEY_CALENDAR_EVENTS   5
#define KEY_WEATHER_TEMP      6
#define KEY_WEATHER_CODE      7
#define KEY_SHOW_TICKS        8
// 9-11 retired (individual cal colour keys replaced by packed string)
#define KEY_HOUR_HAND_COLOR   12
#define KEY_CAL_COLORS        13  // packed "c0,c1,c2,...,c9" palette indices
#define KEY_MIN_HAND_COLOR    14

#define KEY_EVENT_TEXT_0      15
#define KEY_EVENT_TEXT_1      16
#define KEY_EVENT_TEXT_2      17

#define KEY_EVENT_CAL_0       18
#define KEY_EVENT_CAL_1       19
#define KEY_EVENT_CAL_2       20

#define KEY_SHOW_SECONDS          21
#define KEY_BATTERY_WARNING_ONLY  22
#define KEY_OVERLAY_ABOVE_HANDS   23
#define KEY_HOUR_HAND_STYLE       24
#define KEY_MIN_HAND_STYLE        25
#define KEY_HOUR_HAND_LENGTH      56
#define KEY_MIN_HAND_LENGTH       57
#define KEY_SHOW_NEXT_LOCATION    58
#define KEY_NEXT_LOCATION         59
#define KEY_BATTERY_DISPLAY_MODE  60
#define KEY_LOCATION_PRIORITY     61
#define KEY_TICK_COLOR            62
#define KEY_CENTER_COLOR          63
#define KEY_SECONDS_COLOR         64
#define KEY_SECONDS_THICKNESS     65
#define KEY_LOCATION_PREFIX       66
#define KEY_COMPLICATION_LEFT     67
#define KEY_COMPLICATION_RIGHT    68
#define KEY_COMPLICATION_TOP      69
#define COMP_EMPTY 0
#define COMP_DATE 1
#define COMP_BATTERY 2
#define COMP_WEATHER 3
#define COMP_WEEK 4
#define COMP_SECONDS 5
#define COMP_BEATS 6
#define COMP_DATE_DDMM 7

// Rendering of Screenshots
#define SCREENSHOT_MODE 0
#define DEBUG_ICS 0


// --- Colour palette -------------------------------------------
// Must match PALETTE in index.html exactly.
static const uint8_t s_palette_argb[16] = {
    0xCE, // 0: Turquoise #00FFAA
    0xDC, // 1: Lime #55FF00
    0xCF, // 2: Cyan #00FFFF
    0xC7, // 3: Blue #0055FF
    0xEB, // 4: Lavender #AAAAFF
    0xE3, // 5: Violet #AA00FF
    0xF7, // 6: Magenta #FF55FF
    0xF0, // 7: Red #FF0000
    0xF5, // 8: Coral #FF5555
    0xF8, // 9: Orange #FFAA00
    0xFC, // 10: Yellow #FFFF00
    0xFF, // 11: White #FFFFFF
    0xEA, // 12: Light gray #AAAAAA
    0xD5, // 13: Dark gray #555555
    0xD2, // 14: Indigo #5500AA
    0xCC, // 15: Neon green #00FF00

};

static GColor palette_color(int idx) {
    if (idx < 0 || idx > 15) idx = 0;
    return (GColor){ .argb = s_palette_argb[idx] };
}

// --- Calendar config ------------------------------------------
#define MAX_CALENDARS 10
#define MAX_EVENTS    10  // max arcs on screen at once

typedef struct {
    int start_mins;
    int duration_mins;
    int cal_index;   // 0-9, indexes into s_cal_color_idx
    bool all_day;    // true for date-only VEVENT; never render as arc
    int full_start_mins; // unwrapped 0-1439 minutes, for 24h event text
} CalEvent;

// --- State ---------------------------------------------------
static Window *s_window;
static Layer  *s_canvas_layer;

static GColor s_bg_color   = GColorBlack;
static GColor s_text_color = GColorWhite;
static bool   s_use_fahrenheit = false;
static bool   s_show_date      = true; // legacy
static int s_complication_left = COMP_DATE;
static int s_complication_right = COMP_WEATHER;
static int s_complication_top = COMP_BATTERY;
static bool   s_show_ticks     = true;

// Default colours spread across the palette for visual variety
static int s_cal_color_idx[MAX_CALENDARS] = { 0, 4, 8, 2, 9, 5, 1, 7, 10, 3 };
static int s_hour_hand_color = 11;
static int s_min_hand_color  = 11;
static int s_tick_color      = 11; // formerly shared with minute hand
static int s_center_color    = 11; // independent hub color
static int s_seconds_color   = 7;  // red as before
static int s_seconds_thickness = 1; // original line width is 1 pixel
static int s_hour_hand_style = 0; // 0: classic, 1: Minimalin
static int s_min_hand_style  = 0; // 0: classic, 1: Minimalin, 2: rainbow
static int s_hour_hand_length = 0; // short, medium, long
static int s_min_hand_length = 0;
static char s_next_location[81];
static char s_location_prefix[21] = "Ort: ";
static bool s_location_priority = false;
static GBitmap *s_rainbow_bitmap;
static bool s_overlay_above_hands = false; // default: UNDER hands

static bool s_show_seconds = true;
static int s_battery_display_mode = 20; // -1 off, 0 always, else threshold

static int  s_battery_percent = 100;
static bool s_battery_charging = false;

static char s_event_text[3][32];
static int  s_event_cal[3];

static int s_weather_temp = INT_MIN;
static int s_weather_code = -1;

static CalEvent s_events[MAX_EVENTS];
static int      s_event_count = 0;

static GFont s_small_font;
static GFont s_date_font;

// --- Square perimeter helper ----------------------------------
static GPoint perimeter_point(GRect bounds, int inset, int angle_deg) {
    // Intersect the watch-hand ray with the inset rectangular dial boundary.
    // Linear perimeter interpolation distorts the clock angles.
    const int32_t half_w = bounds.size.w / 2 - 1 - inset;
    const int32_t half_h = bounds.size.h / 2 - 1 - inset;
    const int32_t sn = sin_lookup(DEG_TO_TRIGANGLE(angle_deg));
    const int32_t cv = cos_lookup(DEG_TO_TRIGANGLE(angle_deg));
    const int32_t abs_sn = sn < 0 ? -sn : sn;
    const int32_t abs_cv = cv < 0 ? -cv : cv;
    int32_t radius_x = abs_sn ? half_w * TRIG_MAX_RATIO / abs_sn : INT32_MAX;
    int32_t radius_y = abs_cv ? half_h * TRIG_MAX_RATIO / abs_cv : INT32_MAX;
    int32_t radius = radius_x < radius_y ? radius_x : radius_y;
    const int cx = bounds.origin.x + bounds.size.w / 2;
    const int cy = bounds.origin.y + bounds.size.h / 2;
    return GPoint(cx + sn * radius / TRIG_MAX_RATIO,
                  cy - cv * radius / TRIG_MAX_RATIO);
}

// --- Proximity helpers ----------------------------------------
static bool segment_near_rect(int x0, int y0, int x1, int y1,
                               int rx, int ry, int rw, int rh,
                               int threshold) {
    int cx = rx + rw / 2, cy = ry + rh / 2;
    int hw = rw / 2 + threshold, hv = rh / 2 + threshold;
    for (int t = 0; t <= 8; t++) {
        int px = x0 + (x1 - x0) * t / 8;
        int py = y0 + (y1 - y0) * t / 8;
        int dx = px - cx; if (dx < 0) dx = -dx;
        int dy = py - cy; if (dy < 0) dy = -dy;
        if (dx <= hw && dy <= hv) return true;
    }
    return false;
}

static bool point_near_rect(int px, int py,
                             int rx, int ry, int rw, int rh,
                             int threshold) {
    int cx = rx + rw / 2, cy = ry + rh / 2;
    int dx = px - cx; if (dx < 0) dx = -dx;
    int dy = py - cy; if (dy < 0) dy = -dy;
    return (dx <= rw / 2 + threshold && dy <= rh / 2 + threshold);
}

// --- Shadow decision ------------------------------------------
static bool compute_show_shadow(GRect bounds, GPoint centre,
                                 int clock_radius, bool is_round,
                                 int hour_len, int min_len,
                                 int hour_angle, int min_angle,
                                 int wx, int wy, int ww, int wh) {
    int threshold = 18;

    GPoint tip_hour = GPoint(
        centre.x + sin_lookup(DEG_TO_TRIGANGLE(hour_angle)) * hour_len / TRIG_MAX_RATIO,
        centre.y - cos_lookup(DEG_TO_TRIGANGLE(hour_angle)) * hour_len / TRIG_MAX_RATIO
    );
    GPoint tip_min = GPoint(
        centre.x + sin_lookup(DEG_TO_TRIGANGLE(min_angle)) * min_len / TRIG_MAX_RATIO,
        centre.y - cos_lookup(DEG_TO_TRIGANGLE(min_angle)) * min_len / TRIG_MAX_RATIO
    );
    if (segment_near_rect(centre.x, centre.y, tip_hour.x, tip_hour.y,
                          wx, wy, ww, wh, threshold)) return true;
    if (segment_near_rect(centre.x, centre.y, tip_min.x, tip_min.y,
                          wx, wy, ww, wh, threshold)) return true;

    if (s_show_ticks) {
        int arc_inset = 4;
        for (int h = 0; h < 12; h++) {
            int deg = h * 30;
            int tick_len = (h % 3 == 0) ? 14 : 9;
            if (is_round) {
                int32_t trig = DEG_TO_TRIGANGLE(deg);
                int sv = sin_lookup(trig), cv = cos_lookup(trig);
                GPoint outer = GPoint(
                    centre.x + sv * clock_radius / TRIG_MAX_RATIO,
                    centre.y - cv * clock_radius / TRIG_MAX_RATIO);
                GPoint inner = GPoint(
                    centre.x + sv * (clock_radius - tick_len) / TRIG_MAX_RATIO,
                    centre.y - cv * (clock_radius - tick_len) / TRIG_MAX_RATIO);
                if (segment_near_rect(outer.x, outer.y, inner.x, inner.y,
                                      wx, wy, ww, wh, threshold)) return true;
            } else {
                GPoint outer = perimeter_point(bounds, arc_inset, deg);
                int dx = centre.x - outer.x, dy = centre.y - outer.y;
                int dist2 = dx * dx + dy * dy, dist = tick_len;
                if (dist2 > 0) {
                    int r = (dist2 > 0x10000) ? 256 : 16;
                    for (int n = 0; n < 8; n++) r = (r + dist2 / r) / 2;
                    dist = r;
                }
                GPoint inner = GPoint(
                    outer.x + (dx * tick_len * 16 / dist) / 16,
                    outer.y + (dy * tick_len * 16 / dist) / 16);
                if (segment_near_rect(outer.x, outer.y, inner.x, inner.y,
                                      wx, wy, ww, wh, threshold)) return true;
            }
        }
    }

    for (int i = 0; i < s_event_count; i++) {
        CalEvent *ev = &s_events[i];
        if (ev->all_day || ev->duration_mins <= 0) continue;
        int start = ev->start_mins;
        int end   = ev->start_mins + ev->duration_mins;
        start = start % 720;
        if (end   >  720) end = 720;
        int start_deg = start * 360 / 720;
        int end_deg   = end   * 360 / 720;
        if (is_round) {
            int arc_radius = clock_radius + 8;
            for (int deg = start_deg; deg <= end_deg; deg += 5) {
                int px = centre.x + sin_lookup(DEG_TO_TRIGANGLE(deg)) * arc_radius / TRIG_MAX_RATIO;
                int py = centre.y - cos_lookup(DEG_TO_TRIGANGLE(deg)) * arc_radius / TRIG_MAX_RATIO;
                if (point_near_rect(px, py, wx, wy, ww, wh, threshold)) return true;
            }
        } else {
            for (int deg = start_deg; deg <= end_deg; deg += 5) {
                GPoint p = perimeter_point(bounds, 4, deg);
                if (point_near_rect(p.x, p.y, wx, wy, ww, wh, threshold)) return true;
            }
        }
    }
    return false;
}

static void battery_callback(BatteryChargeState state) {
    s_battery_percent  = state.charge_percent;
    s_battery_charging = state.is_charging;

    layer_mark_dirty(s_canvas_layer);
}

// --- Tick handler ---------------------------------------------
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
    layer_mark_dirty(s_canvas_layer);
}

// --- Parse helper ---------------------------------------------
static int parse_int(const char **p) {
    int val = 0;
    while (**p >= '0' && **p <= '9') {
        val = val * 10 + (**p - '0');
        (*p)++;
    }
    return val;
}

static void update_tick_subscription(void) {

    tick_timer_service_unsubscribe();

    tick_timer_service_subscribe(
        s_show_seconds ? SECOND_UNIT : MINUTE_UNIT,
        tick_handler
    );
}

// --- Weather icon drawing -------------------------------------

static void draw_cloud(GContext *ctx, int ox, int oy, bool shadow) {
    if (shadow) {
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_circle(ctx, GPoint(ox + 5,  oy + 13), 5);
        graphics_fill_circle(ctx, GPoint(ox + 13, oy + 13), 5);
        graphics_fill_circle(ctx, GPoint(ox + 9,  oy + 9),  6);
        graphics_fill_rect(ctx, GRect(ox + 2, oy + 10, 16, 7), 0, GCornerNone);
    }
    graphics_context_set_fill_color(ctx, GColorLightGray);
    graphics_fill_circle(ctx, GPoint(ox + 5,  oy + 13), 4);
    graphics_fill_circle(ctx, GPoint(ox + 13, oy + 13), 4);
    graphics_fill_circle(ctx, GPoint(ox + 9,  oy + 9),  5);
    graphics_fill_rect(ctx, GRect(ox + 3, oy + 11, 14, 5), 0, GCornerNone);
}

static void draw_sun(GContext *ctx, int ox, int oy, bool shadow) {
    int cx = ox + 10, cy = oy + 10;
    static const int ray_dx[8] = { 0,  3,  4,  3,  0, -3, -4, -3 };
    static const int ray_dy[8] = {-4, -3,  0,  3,  4,  3,  0, -3 };
    if (shadow) {
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 3);
        for (int r = 0; r < 8; r++)
            graphics_draw_line(ctx,
                GPoint(cx + ray_dx[r] * 6 / 4, cy + ray_dy[r] * 6 / 4),
                GPoint(cx + ray_dx[r] * 10 / 4, cy + ray_dy[r] * 10 / 4));
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_circle(ctx, GPoint(cx, cy), 5);
    }
    graphics_context_set_stroke_color(ctx, GColorYellow);
    graphics_context_set_stroke_width(ctx, 1);
    for (int r = 0; r < 8; r++)
        graphics_draw_line(ctx,
            GPoint(cx + ray_dx[r] * 6 / 4, cy + ray_dy[r] * 6 / 4),
            GPoint(cx + ray_dx[r] * 10 / 4, cy + ray_dy[r] * 10 / 4));
    graphics_context_set_fill_color(ctx, GColorYellow);
    graphics_fill_circle(ctx, GPoint(cx, cy), 4);
}

static void draw_rain(GContext *ctx, int ox, int oy, GColor drop_color, bool shadow) {
    draw_cloud(ctx, ox, oy - 2, shadow);
    if (shadow) {
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 3);
        graphics_draw_line(ctx, GPoint(ox + 5,  oy + 14), GPoint(ox + 4,  oy + 17));
        graphics_draw_line(ctx, GPoint(ox + 9,  oy + 14), GPoint(ox + 8,  oy + 17));
        graphics_draw_line(ctx, GPoint(ox + 13, oy + 14), GPoint(ox + 12, oy + 17));
    }
    graphics_context_set_stroke_color(ctx, drop_color);
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_line(ctx, GPoint(ox + 5,  oy + 14), GPoint(ox + 4,  oy + 17));
    graphics_draw_line(ctx, GPoint(ox + 9,  oy + 14), GPoint(ox + 8,  oy + 17));
    graphics_draw_line(ctx, GPoint(ox + 13, oy + 14), GPoint(ox + 12, oy + 17));
}

static void draw_snow(GContext *ctx, int ox, int oy, bool shadow) {
    draw_cloud(ctx, ox, oy - 2, shadow);
    int cx = ox + 9, cy = oy + 16;
    if (shadow) {
        graphics_context_set_fill_color(ctx, GColorBlack);
        static const int sx[9] = {0,0,0,-3,3,-2,2,-2,2};
        static const int sy[9] = {0,-3,3,0,0,-2,-2,2,2};
        for (int d = 0; d < 9; d++)
            graphics_fill_circle(ctx, GPoint(cx + sx[d], cy + sy[d]), 2);
    }
    graphics_context_set_fill_color(ctx, GColorCyan);
    static const int sx[9] = {0,0,0,-3,3,-2,2,-2,2};
    static const int sy[9] = {0,-3,3,0,0,-2,-2,2,2};
    for (int d = 0; d < 9; d++)
        graphics_fill_circle(ctx, GPoint(cx + sx[d], cy + sy[d]), 1);
}

static void draw_thunder(GContext *ctx, int ox, int oy, bool shadow) {
    draw_cloud(ctx, ox, oy - 2, shadow);
    if (shadow) {
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 4);
        graphics_draw_line(ctx, GPoint(ox + 11, oy + 12), GPoint(ox + 8,  oy + 16));
        graphics_draw_line(ctx, GPoint(ox + 8,  oy + 16), GPoint(ox + 11, oy + 16));
        graphics_draw_line(ctx, GPoint(ox + 11, oy + 16), GPoint(ox + 7,  oy + 20));
    }
    graphics_context_set_stroke_color(ctx, GColorYellow);
    graphics_context_set_stroke_width(ctx, 2);
    graphics_draw_line(ctx, GPoint(ox + 11, oy + 12), GPoint(ox + 8,  oy + 16));
    graphics_draw_line(ctx, GPoint(ox + 8,  oy + 16), GPoint(ox + 11, oy + 16));
    graphics_draw_line(ctx, GPoint(ox + 11, oy + 16), GPoint(ox + 7,  oy + 20));
}

static void draw_fog(GContext *ctx, int ox, int oy, bool shadow) {
    if (shadow) {
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 4);
        graphics_draw_line(ctx, GPoint(ox + 2, oy + 7),  GPoint(ox + 18, oy + 7));
        graphics_draw_line(ctx, GPoint(ox + 2, oy + 11), GPoint(ox + 18, oy + 11));
        graphics_draw_line(ctx, GPoint(ox + 2, oy + 15), GPoint(ox + 18, oy + 15));
    }
    graphics_context_set_stroke_color(ctx, GColorLightGray);
    graphics_context_set_stroke_width(ctx, 2);
    graphics_draw_line(ctx, GPoint(ox + 2, oy + 7),  GPoint(ox + 18, oy + 7));
    graphics_draw_line(ctx, GPoint(ox + 2, oy + 11), GPoint(ox + 18, oy + 11));
    graphics_draw_line(ctx, GPoint(ox + 2, oy + 15), GPoint(ox + 18, oy + 15));
}

static void draw_partly_cloudy(GContext *ctx, int ox, int oy, bool shadow) {
    int sx = ox + 5, sy = oy + 5;
    static const int ray_dx[8] = { 0,  2,  3,  2,  0, -2, -3, -2 };
    static const int ray_dy[8] = {-3, -2,  0,  2,  3,  2,  0, -2 };
    if (shadow) {
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 3);
        for (int r = 0; r < 8; r++)
            graphics_draw_line(ctx,
                GPoint(sx + ray_dx[r] * 4 / 3, sy + ray_dy[r] * 4 / 3),
                GPoint(sx + ray_dx[r] * 6 / 3, sy + ray_dy[r] * 6 / 3));
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_circle(ctx, GPoint(sx, sy), 4);
    }
    graphics_context_set_stroke_color(ctx, GColorYellow);
    graphics_context_set_stroke_width(ctx, 1);
    for (int r = 0; r < 8; r++)
        graphics_draw_line(ctx,
            GPoint(sx + ray_dx[r] * 4 / 3, sy + ray_dy[r] * 4 / 3),
            GPoint(sx + ray_dx[r] * 6 / 3, sy + ray_dy[r] * 6 / 3));
    graphics_context_set_fill_color(ctx, GColorYellow);
    graphics_fill_circle(ctx, GPoint(sx, sy), 3);
    draw_cloud(ctx, ox + 2, oy + 3, shadow);
}

static void draw_weather_icon(GContext *ctx, int code, int ox, int oy, bool shadow) {
    if (code == 0)                      draw_sun(ctx, ox, oy, shadow);
    else if (code >= 1  && code <= 3)   draw_partly_cloudy(ctx, ox, oy, shadow);
    else if (code == 45 || code == 48)  draw_fog(ctx, ox, oy, shadow);
    else if (code >= 51 && code <= 67)  draw_rain(ctx, ox, oy, code >= 56 ? GColorCyan : GColorBlue, shadow);
    else if (code >= 71 && code <= 77)  draw_snow(ctx, ox, oy, shadow);
    else if (code >= 80 && code <= 82)  draw_rain(ctx, ox, oy, GColorBlue, shadow);
    else if (code >= 85 && code <= 86)  draw_snow(ctx, ox, oy, shadow);
    else if (code >= 95 && code <= 99)  draw_thunder(ctx, ox, oy, shadow);
}


/* Original Minimalin Reborn hand dimensions, scaled for the watch size.
 * The rainbow-hand image uses the original Minimalin rotation pivot. */
static void draw_clock_hands(GContext *ctx, GPoint centre,
                             int hour_angle, int min_angle, int sec_angle,
                             int hour_len, int min_len, int clock_radius,
                             bool is_round) {
    const int hour_width = s_hour_hand_style == 1 ? (is_round ? 6 : 8) : 5;
    const int min_width  = s_min_hand_style == 1 ? (is_round ? 6 : 8) : 3;
    GPoint tip_hour = GPoint(
        centre.x + sin_lookup(DEG_TO_TRIGANGLE(hour_angle)) * hour_len / TRIG_MAX_RATIO,
        centre.y - cos_lookup(DEG_TO_TRIGANGLE(hour_angle)) * hour_len / TRIG_MAX_RATIO);
    GPoint tip_min = GPoint(
        centre.x + sin_lookup(DEG_TO_TRIGANGLE(min_angle)) * min_len / TRIG_MAX_RATIO,
        centre.y - cos_lookup(DEG_TO_TRIGANGLE(min_angle)) * min_len / TRIG_MAX_RATIO);

    graphics_context_set_stroke_color(ctx, palette_color(s_hour_hand_color));
    graphics_context_set_stroke_width(ctx, hour_width);
    graphics_draw_line(ctx, centre, tip_hour);
    if (s_hour_hand_style == 1) {
        graphics_context_set_fill_color(ctx, palette_color(s_hour_hand_color));
        graphics_fill_circle(ctx, tip_hour, hour_width / 2);
    }

    // Draw minute hand over hour hand. Rainbow is vector-drawn from the true centre,
    // avoiding the black/offset portion of the old opaque bitmap.
    if (s_min_hand_style == 2) {
        static const int rainbow_colors[] = {7, 9, 10, 1, 2, 3, 5};
        for (int s = 0; s < 7; ++s) {
            int r0 = (min_len * s) / 7;
            int r1 = (min_len * (s + 1)) / 7;
            int32_t sn = sin_lookup(DEG_TO_TRIGANGLE(min_angle));
            int32_t cs = cos_lookup(DEG_TO_TRIGANGLE(min_angle));
            GPoint from = GPoint(centre.x + sn * r0 / TRIG_MAX_RATIO,
                                 centre.y - cs * r0 / TRIG_MAX_RATIO);
            GPoint to = GPoint(centre.x + sn * r1 / TRIG_MAX_RATIO,
                               centre.y - cs * r1 / TRIG_MAX_RATIO);
            graphics_context_set_stroke_color(ctx, palette_color(rainbow_colors[s]));
            graphics_context_set_stroke_width(ctx, is_round ? 6 : 8);
            graphics_draw_line(ctx, from, to);
        }
    } else {
        graphics_context_set_stroke_color(ctx, palette_color(s_min_hand_color));
        graphics_context_set_stroke_width(ctx, min_width);
        graphics_draw_line(ctx, centre, tip_min);
        if (s_min_hand_style == 1) {
            graphics_context_set_fill_color(ctx, palette_color(s_min_hand_color));
            graphics_fill_circle(ctx, tip_min, min_width / 2);
        }
    }

    if (s_show_seconds) {
        const int sec_len = clock_radius - 6;
        GPoint tip_sec = GPoint(
            centre.x + sin_lookup(DEG_TO_TRIGANGLE(sec_angle)) * sec_len / TRIG_MAX_RATIO,
            centre.y - cos_lookup(DEG_TO_TRIGANGLE(sec_angle)) * sec_len / TRIG_MAX_RATIO);
        graphics_context_set_stroke_color(ctx, palette_color(s_seconds_color));
        graphics_context_set_stroke_width(ctx, s_seconds_thickness);
        graphics_draw_line(ctx, centre, tip_sec);
    }
    // The independently colored central pivot must cover both hands.
    graphics_context_set_fill_color(ctx, palette_color(s_center_color));
    graphics_fill_circle(ctx, centre, is_round ? 5 : 7);
}


// Current hour position on the outer calendar-arc dial.
// Intentionally drawn last, over arcs, text and every other complication.
static void draw_hour_arc_indicator(GContext *ctx, GRect bounds, GPoint centre,
                                    int clock_radius, bool is_round,
                                    int hour_angle) {
    const int marker_len = 12;   // same as ordinary (non-cardinal) tick
    const int marker_width = 2;
    GPoint outer, inner;
    if (is_round) {
        int sv = sin_lookup(DEG_TO_TRIGANGLE(hour_angle));
        int cv = cos_lookup(DEG_TO_TRIGANGLE(hour_angle));
        outer = GPoint(centre.x + sv * clock_radius / TRIG_MAX_RATIO,
                       centre.y - cv * clock_radius / TRIG_MAX_RATIO);
        inner = GPoint(centre.x + sv * (clock_radius - marker_len) / TRIG_MAX_RATIO,
                       centre.y - cv * (clock_radius - marker_len) / TRIG_MAX_RATIO);
    } else {
        outer = perimeter_point(bounds, 4, hour_angle);
        int dx = centre.x - outer.x, dy = centre.y - outer.y;
        int dist2 = dx * dx + dy * dy;
        int dist = 16;
        if (dist2 > 0) {
            dist = dist2 > 0x10000 ? 256 : 16;
            for (int i = 0; i < 8; ++i) dist = (dist + dist2 / dist) / 2;
        }
        inner = GPoint(outer.x + dx * marker_len / dist,
                       outer.y + dy * marker_len / dist);
    }
    graphics_context_set_stroke_color(ctx, palette_color(s_hour_hand_color));
    graphics_context_set_stroke_width(ctx, marker_width);
    graphics_draw_line(ctx, outer, inner);
}

// --- Canvas draw ---------------------------------------------
// Appointment text and location share one configurable drawing layer.
// All weather/date elements are always drawn before the clock hands.
static void draw_appointment_text(GContext *ctx, GRect bounds, GPoint centre,
                                  int clock_radius, bool show_location) {
    // -- Meeting Text ---------------------------------------------
  
  
    int text_y = bounds.size.h - 80;
  
    for (int i = 0; i < 3; i++) {
    
        if (strlen(s_event_text[i]) == 0)
            continue;
    
        int mins = s_events[i].full_start_mins;
        int h = mins / 60;
        int m = mins % 60;
    
        char time_buf[6];
        snprintf(time_buf, sizeof(time_buf), "%02d:%02d", h, m);
    
        char buf[64];
        if (i < s_event_count && s_events[i].all_day) {
            snprintf(buf, sizeof(buf), "All day: %s", s_event_text[i]);
        } else {
            snprintf(buf, sizeof(buf), "%s %s", time_buf, s_event_text[i]);
        }
    
        int event_cal = s_event_cal[i];
        if (event_cal < 0 || event_cal >= MAX_CALENDARS)
            event_cal = 0;
    
        graphics_context_set_text_color(
            ctx,
            palette_color(s_cal_color_idx[event_cal])
        );
    
        graphics_draw_text(
            ctx,
            buf,
            s_small_font,
            GRect(8, text_y + i * 16, bounds.size.w - 8, 16),
            GTextOverflowModeTrailingEllipsis,
            GTextAlignmentCenter,
            NULL
        );
    }

    // Shared upper dial slot: location overrides battery only in the
    // fifteen-minute window calculated by the phone.
    if (show_location) {
        char label[88];
        snprintf(label, sizeof(label), "%s%s", s_location_prefix, s_next_location);
        int loc_y = centre.y - clock_radius + 18;
        graphics_context_set_text_color(ctx, s_text_color);
        graphics_draw_text(ctx, label, s_small_font,
            GRect(4, loc_y, bounds.size.w - 8, 38),
            GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    }
}

// Render text-only complications in a slot. Weather/date preserve their legacy
// layouts in their original slots, handled directly in canvas_update_proc.
static void draw_complication_text(GContext *ctx, GRect area, int type,
                                   struct tm *now, bool use_fahrenheit) {
    char value[48] = "";
    if (type == COMP_EMPTY) return;
    if (type == COMP_DATE) {
        snprintf(value, sizeof(value), "%d", now->tm_mday);
    } else if (type == COMP_DATE_DDMM) {
        snprintf(value, sizeof(value), "%02d.%02d", now->tm_mday, now->tm_mon + 1);
    } else if (type == COMP_BATTERY) {
        bool visible = s_battery_display_mode == 0 ||
            (s_battery_display_mode > 0 && s_battery_percent <= s_battery_display_mode);
        if (!visible) return;
        snprintf(value, sizeof(value), "%s%d%%", s_battery_charging ? "+" : "", s_battery_percent);
    } else if (type == COMP_WEATHER) {
        if (s_weather_temp == INT_MIN) snprintf(value, sizeof(value), "--");
        else snprintf(value, sizeof(value), "%d\xC2\xB0%c", s_weather_temp, use_fahrenheit ? 'F' : 'C');
    } else if (type == COMP_WEEK) {
        char week[8];
        strftime(week, sizeof(week), "%V", now);
        snprintf(value, sizeof(value), "%s", week);
    } else if (type == COMP_SECONDS) {
        snprintf(value, sizeof(value), "%02d", now->tm_sec);
    } else if (type == COMP_BEATS) {
        // Swatch Internet Time uses UTC+1 without daylight saving adjustment.
        time_t t = time(NULL);
        struct tm *utc = gmtime(&t);
        if (!utc) return;
        int seconds = ((utc->tm_hour + 1) % 24) * 3600 + utc->tm_min * 60 + utc->tm_sec;
        snprintf(value, sizeof(value), "@%03d", seconds * 1000 / 86400);
    } else return;
    graphics_context_set_text_color(ctx, s_text_color);
    GFont font = (type == COMP_DATE || type == COMP_WEEK) ? s_date_font : s_small_font;
    graphics_draw_text(ctx, value, font, area,
        GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
    GRect   bounds = layer_get_bounds(layer);
    GPoint  centre = GPoint(bounds.size.w / 2, bounds.size.h / 2);

    graphics_context_set_fill_color(ctx, s_bg_color);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    time_t     now_t = time(NULL);
    struct tm *now   = localtime(&now_t);
    #if SCREENSHOT_MODE
      now->tm_hour = 10;
      now->tm_min  = 10;
      now->tm_sec  = 0;
    #endif
    
    // Add Fake events for emulator
    #if SCREENSHOT_MODE
        APP_LOG(APP_LOG_LEVEL_ERROR, "SCREENSHOT MODE ON");
    #else
        APP_LOG(APP_LOG_LEVEL_ERROR, "SCREENSHOT MODE OFF");
    #endif
    #if SCREENSHOT_MODE
      s_event_count = 2;
  
      // 11:00 → 2:30 (Blue)
      s_events[0].start_mins    = 11*60;
      s_events[0].duration_mins = 90;
      s_events[0].cal_index     = 0;
      s_events[0].all_day       = false;
  
      // 3:00 → 4:00 (Red)
      s_events[1].start_mins    = 180;
      s_events[1].duration_mins = 60;
      s_events[1].cal_index     = 1;
      s_events[1].all_day       = false;
  
      s_cal_color_idx[0] = 3; // Blue
      s_cal_color_idx[1] = 7; // Red
    #endif

    int hour_angle = (now->tm_hour % 12) * 30 + now->tm_min / 2;
    int min_angle  = now->tm_min * 6 + now->tm_sec / 10;
    int sec_angle = now->tm_sec * 6;

    int clock_radius = MIN(bounds.size.w, bounds.size.h) / 2 - 10;
    bool is_round = (bounds.size.w == bounds.size.h);

    int hour_len, min_len;
    if (is_round) {
        hour_len = clock_radius * 7 / 10;
        min_len  = clock_radius * 19 / 20;
    } else {
        hour_len = clock_radius * 9 / 10;
        min_len  = clock_radius;
    }

    // Keep weather-overlay collision checking consistent with hand geometry.
    // Three length presets. Short preserves the original Minimalin geometry.
    // Classic retains its old length when the default setting is selected.
    if (s_hour_hand_style == 1 || s_hour_hand_length != 0) {
        static const int hour_percent[] = {47, 67, 88};
        hour_len = clock_radius * hour_percent[s_hour_hand_length] / 100;
    }
    if (s_min_hand_style != 0 || s_min_hand_length != 0) {
        static const int min_percent[] = {63, 81, 96};
        min_len = clock_radius * min_percent[s_min_hand_length] / 100;
    }

    // Always make the minute hand distinctly longer, even with mixed presets.
    if (min_len < hour_len + 10) min_len = MIN(clock_radius, hour_len + 10);

    int weather_x = (centre.x + (bounds.size.w - centre.x) / 2) - 5;
    int weather_y = centre.y - 11;
    int wx = weather_x - 20, wy = weather_y, ww = 60, wh = 40;

    bool show_shadow = compute_show_shadow(
        bounds, centre, clock_radius, is_round,
        hour_len, min_len, hour_angle, min_angle,
        wx, wy, ww, wh);

    // -- Hour tick marks ---------------------------------------
    // Do not show tick marks on emulator
    #if SCREENSHOT_MODE
        bool show_ticks = false;
    #else
        bool show_ticks = s_show_ticks;
    #endif
    if (show_ticks) {
        int arc_inset = 4;
        graphics_context_set_stroke_color(ctx, palette_color(s_tick_color));
        for (int h = 0; h < 12; h++) {
            int deg = h * 30;
            bool is_cardinal = (h % 3 == 0);
            int tick_len   = is_cardinal ? 18 : 12;
            int tick_width = is_cardinal ? 4  : 2;
            graphics_context_set_stroke_width(ctx, tick_width);
            if (is_round) {
                int32_t trig = DEG_TO_TRIGANGLE(deg);
                int sv = sin_lookup(trig), cv = cos_lookup(trig);
                GPoint outer = GPoint(
                    centre.x + sv * clock_radius / TRIG_MAX_RATIO,
                    centre.y - cv * clock_radius / TRIG_MAX_RATIO);
                GPoint inner = GPoint(
                    centre.x + sv * (clock_radius - tick_len) / TRIG_MAX_RATIO,
                    centre.y - cv * (clock_radius - tick_len) / TRIG_MAX_RATIO);
                graphics_draw_line(ctx, outer, inner);
            } else {
                GPoint outer = perimeter_point(bounds, arc_inset, deg);
                int dx = centre.x - outer.x, dy = centre.y - outer.y;
                int dist2 = dx * dx + dy * dy, dist = tick_len;
                if (dist2 > 0) {
                    int r = (dist2 > 0x10000) ? 256 : 16;
                    for (int n = 0; n < 8; n++) r = (r + dist2 / r) / 2;
                    dist = r;
                }
                GPoint inner = GPoint(
                    outer.x + (dx * tick_len * 16 / dist) / 16,
                    outer.y + (dy * tick_len * 16 / dist) / 16);
                graphics_draw_line(ctx, outer, inner);
            }
        }
    }

    // -- Calendar arc ring -------------------------------------
    int arc_stroke = 8;
    
    for (int i = 0; i < s_event_count; i++) {
        CalEvent *ev = &s_events[i];
        if (ev->all_day || ev->duration_mins <= 0) continue;
    
        int raw_start = ev->start_mins;
        int raw_end   = ev->start_mins + ev->duration_mins;
    
        // Normalize to 12-hour dial (0–720)
        int start = raw_start % 720;
        int end   = raw_end   % 720;
    
        bool wraps = (raw_end - raw_start) >= 720 ? true : (end < start);
    
        int ci = ev->cal_index;
        if (ci < 0 || ci >= MAX_CALENDARS) ci = 0;
    
        GColor color = palette_color(s_cal_color_idx[ci]);
        graphics_context_set_stroke_color(ctx, color);
        graphics_context_set_stroke_width(ctx, arc_stroke);
    
        // Helper to draw a segment
        #define DRAW_ARC_SEGMENT(seg_start, seg_end) \
            do { \
                int start_deg = (seg_start) * 360 / 720; \
                int end_deg   = (seg_end)   * 360 / 720; \
                if (is_round) { \
                    int arc_radius = clock_radius + arc_stroke; \
                    for (int deg = start_deg; deg < end_deg; deg += 3) { \
                        int d2 = (deg + 3 < end_deg) ? deg + 3 : end_deg; \
                        GPoint p1 = GPoint( \
                            centre.x + sin_lookup(DEG_TO_TRIGANGLE(deg)) * arc_radius / TRIG_MAX_RATIO, \
                            centre.y - cos_lookup(DEG_TO_TRIGANGLE(deg)) * arc_radius / TRIG_MAX_RATIO); \
                        GPoint p2 = GPoint( \
                            centre.x + sin_lookup(DEG_TO_TRIGANGLE(d2)) * arc_radius / TRIG_MAX_RATIO, \
                            centre.y - cos_lookup(DEG_TO_TRIGANGLE(d2)) * arc_radius / TRIG_MAX_RATIO); \
                        graphics_draw_line(ctx, p1, p2); \
                    } \
                } else { \
                    int inset = arc_stroke / 2; \
                    for (int deg = start_deg; deg < end_deg; deg += 1) { \
                        int d2 = (deg + 1 < end_deg) ? deg + 1 : end_deg; \
                        GPoint p1 = perimeter_point(bounds, inset, deg); \
                        GPoint p2 = perimeter_point(bounds, inset, d2); \
                        graphics_draw_line(ctx, p1, p2); \
                    } \
                } \
            } while (0)
    
        if (!wraps) {
            // Normal case
            DRAW_ARC_SEGMENT(start, end);
        } else {
            // Wraps past 12 → split into two arcs
            DRAW_ARC_SEGMENT(start, 720);
            DRAW_ARC_SEGMENT(0, end);
        }
    
        #undef DRAW_ARC_SEGMENT
    }
  
    // ===============================
    // OVERLAY (BEFORE HANDS = UNDER)
    // ===============================
    // Three independent complication slots. Their defaults reproduce the
    // legacy left-date/right-weather/top-battery layout.
    bool show_battery = s_battery_display_mode == 0 ||
        (s_battery_display_mode > 0 && s_battery_percent <= s_battery_display_mode);
    bool show_location = s_next_location[0] != '\0' &&
        (s_location_priority || (s_complication_top == COMP_BATTERY && !show_battery));

    // Same left anchor as the legacy large date. Mirrored on the right;
    // neither side extends into the outer clock tick marks.
    int slot_width = is_round ? 45 : 44;
    int slot_inset = is_round ? 24 : 22;
    GRect left_rect = GRect(slot_inset, centre.y - 17, slot_width, 30);
    GRect right_rect = GRect(bounds.size.w - slot_inset - slot_width,
                             centre.y - 17, slot_width, 30);
    GRect top_rect = GRect(4, centre.y - clock_radius + 18, bounds.size.w - 8, 24);
    if (!show_location) {
        draw_complication_text(ctx, top_rect, s_complication_top, now, s_use_fahrenheit);
    }
    draw_complication_text(ctx, left_rect, s_complication_left, now, s_use_fahrenheit);
    if (s_complication_right != COMP_WEATHER) {
        draw_complication_text(ctx, right_rect, s_complication_right, now, s_use_fahrenheit);
    }
    if (s_complication_right == COMP_WEATHER) {
    // -- Weather -----------------------------------------------
    char weather_str[32] = "--\xc2\xb0" "C";
    if (s_weather_temp != INT_MIN) {
        int  temp = s_weather_temp;
        char unit = s_use_fahrenheit ? 'F' : 'C';
        snprintf(weather_str, sizeof(weather_str), "%d\xc2\xb0%c", temp, unit);
    }
    if (show_shadow) {
        static const int offsets[4][2] = {{-1,0},{1,0},{0,-1},{0,1}};
        for (int o = 0; o < 4; o++) {
            graphics_context_set_text_color(ctx, GColorBlack);
            graphics_draw_text(ctx, weather_str, s_small_font,
                GRect(weather_x - 20 + offsets[o][0],
                      weather_y      + offsets[o][1], 60, 20),
                GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
        }
    }
    graphics_context_set_text_color(ctx, s_text_color);
    graphics_draw_text(ctx, weather_str, s_small_font,
        GRect(weather_x - 20, weather_y, 60, 20),
        GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);

    if (s_weather_code >= 0)
        draw_weather_icon(ctx, s_weather_code, weather_x - 8, weather_y + 20, show_shadow);


    }

    // Text is optional foreground: weather and date remain behind the hands.
    if (!s_overlay_above_hands) {
        draw_appointment_text(ctx, bounds, centre, clock_radius, show_location);
    }

    draw_clock_hands(ctx, centre, hour_angle, min_angle, sec_angle,
                     hour_len, min_len, clock_radius, is_round);

    if (s_overlay_above_hands) {
        draw_appointment_text(ctx, bounds, centre, clock_radius, show_location);
    }

    draw_hour_arc_indicator(ctx, bounds, centre, clock_radius, is_round,
                            hour_angle);
}

// --- AppMessage -----------------------------------------------
static void inbox_received_handler(DictionaryIterator *iter, void *context) {
    Tuple *tu = dict_find(iter, KEY_TEMPERATURE_UNIT);
    if (tu) s_use_fahrenheit = (tu->value->int32 != 0);

    Tuple *lcomp = dict_find(iter, KEY_COMPLICATION_LEFT);
    if (lcomp && lcomp->value->int32 >= 0 && lcomp->value->int32 <= 6)
        s_complication_left = (int)lcomp->value->int32;
    Tuple *rcomp = dict_find(iter, KEY_COMPLICATION_RIGHT);
    if (rcomp && rcomp->value->int32 >= 0 && rcomp->value->int32 <= 6)
        s_complication_right = (int)rcomp->value->int32;
    Tuple *tcomp = dict_find(iter, KEY_COMPLICATION_TOP);
    if (tcomp && tcomp->value->int32 >= 0 && tcomp->value->int32 <= 6)
        s_complication_top = (int)tcomp->value->int32;
    Tuple *sd = dict_find(iter, KEY_SHOW_DATE);
    if (sd) s_show_date = (sd->value->int32 != 0);

    Tuple *st = dict_find(iter, KEY_SHOW_TICKS);
    if (st) s_show_ticks = (st->value->int32 != 0);

    Tuple *hh = dict_find(iter, KEY_HOUR_HAND_COLOR);
    if (hh) s_hour_hand_color = (int)hh->value->int32;

    // Calendar colours packed as "c0,c1,c2,...,c9"
    Tuple *cc = dict_find(iter, KEY_CAL_COLORS);
    if (cc) {
        const char *p = cc->value->cstring;
        for (int i = 0; i < MAX_CALENDARS; i++) {
            s_cal_color_idx[i] = parse_int(&p);
            if (*p == ',') p++;
        }
    }

    Tuple *ce = dict_find(iter, KEY_CALENDAR_EVENTS);
    if (ce) {
        s_event_count = 0;
        const char *p = ce->value->cstring;
        while (*p && s_event_count < MAX_EVENTS) {
            int sm = parse_int(&p); if (*p == ',') p++;
            int dm = parse_int(&p); if (*p == ',') p++;
            int ci = parse_int(&p);
            bool all_day = false;
            // Optional fourth value; older phone apps still send three values.
            if (*p == ',') {
                p++;
                all_day = parse_int(&p) != 0;
            }
            s_events[s_event_count].all_day       = all_day;
            s_events[s_event_count].start_mins    = sm;
            s_events[s_event_count].duration_mins = dm;
            s_events[s_event_count].cal_index     = ci;
            s_events[s_event_count].full_start_mins = sm;
            if (*p == ',') {
                p++;
                s_events[s_event_count].full_start_mins = parse_int(&p);
            }
            s_event_count++;
            if (*p == '|') p++; else break;
        }
    }

    Tuple *wt = dict_find(iter, KEY_WEATHER_TEMP);
    if (wt) s_weather_temp = wt->value->int32;

    Tuple *wc = dict_find(iter, KEY_WEATHER_CODE);
    if (wc) s_weather_code = wc->value->int32;

    Tuple *tc = dict_find(iter, KEY_TICK_COLOR);
    if (tc) s_tick_color = (int)tc->value->int32;
    Tuple *hub = dict_find(iter, KEY_CENTER_COLOR);
    if (hub) {
        int col = (int)hub->value->int32;
        s_center_color = (col >= 0 && col < 16) ? col : 11;
    }

    Tuple *mh = dict_find(iter, KEY_MIN_HAND_COLOR);
    if (mh) s_min_hand_color = (int)mh->value->int32;
    
    Tuple *sc = dict_find(iter, KEY_SECONDS_COLOR);
    if (sc) {
        int idx = (int)sc->value->int32;
        s_seconds_color = (idx >= 0 && idx < 16) ? idx : 7;
    }
    Tuple *sw = dict_find(iter, KEY_SECONDS_THICKNESS);
    if (sw) {
        int width = (int)sw->value->int32;
        s_seconds_thickness = (width >= 1 && width <= 3) ? width : 1;
    }

    Tuple *ss = dict_find(iter, KEY_SHOW_SECONDS);
    if (ss) s_show_seconds = (ss->value->int32 != 0);
    
    Tuple *bw = dict_find(iter, KEY_BATTERY_WARNING_ONLY);
    if (bw) s_battery_display_mode = bw->value->int32 ? 20 : 0;
    Tuple *bm = dict_find(iter, KEY_BATTERY_DISPLAY_MODE);
    if (bm) {
        int mode = (int)bm->value->int32;
        if (mode == -1 || mode == 0 || mode == 10 || mode == 20 ||
            mode == 25 || mode == 50) s_battery_display_mode = mode;
    }
    
    update_tick_subscription();
  
    Tuple *e0 = dict_find(iter, KEY_EVENT_TEXT_0);
    Tuple *e1 = dict_find(iter, KEY_EVENT_TEXT_1);
    Tuple *e2 = dict_find(iter, KEY_EVENT_TEXT_2);
    
    if (e0) strncpy(s_event_text[0], e0->value->cstring, sizeof(s_event_text[0]));
    if (e1) strncpy(s_event_text[1], e1->value->cstring, sizeof(s_event_text[1]));
    if (e2) strncpy(s_event_text[2], e2->value->cstring, sizeof(s_event_text[2]));
  
    Tuple *c0 = dict_find(iter, KEY_EVENT_CAL_0);
    Tuple *c1 = dict_find(iter, KEY_EVENT_CAL_1);
    Tuple *c2 = dict_find(iter, KEY_EVENT_CAL_2);
    
    if (c0) s_event_cal[0] = c0->value->int32;
    if (c1) s_event_cal[1] = c1->value->int32;
    if (c2) s_event_cal[2] = c2->value->int32;
  
    Tuple *hl = dict_find(iter, KEY_HOUR_HAND_LENGTH);
    if (hl) {
        int length = (int)hl->value->int32;
        s_hour_hand_length = (length >= 0 && length <= 2) ? length : 0;
    }
    Tuple *ml = dict_find(iter, KEY_MIN_HAND_LENGTH);
    if (ml) {
        int length = (int)ml->value->int32;
        s_min_hand_length = (length >= 0 && length <= 2) ? length : 0;
    }
    Tuple *priority = dict_find(iter, KEY_LOCATION_PRIORITY);
    if (priority) s_location_priority = priority->value->int32 != 0;
    Tuple *prefix = dict_find(iter, KEY_LOCATION_PREFIX);
    if (prefix) {
        snprintf(s_location_prefix, sizeof(s_location_prefix), "%s", prefix->value->cstring);
    }

    Tuple *loc = dict_find(iter, KEY_NEXT_LOCATION);
    if (loc) {
        snprintf(s_next_location, sizeof(s_next_location), "%s", loc->value->cstring);
    }

    Tuple *ov = dict_find(iter, KEY_OVERLAY_ABOVE_HANDS);
    if (ov) s_overlay_above_hands = (ov->value->int32 != 0);

    Tuple *hs = dict_find(iter, KEY_HOUR_HAND_STYLE);
    if (hs) s_hour_hand_style = hs->value->int32 == 1 ? 1 : 0;
    Tuple *ms = dict_find(iter, KEY_MIN_HAND_STYLE);
    if (ms) s_min_hand_style = (ms->value->int32 >= 0 && ms->value->int32 <= 2)
                                ? ms->value->int32 : 0;
    layer_mark_dirty(s_canvas_layer);

}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped: %d", (int)reason);
}

// --- Window lifecycle -----------------------------------------
static void window_load(Window *window) {
    Layer *root   = window_get_root_layer(window);
    GRect  bounds = layer_get_bounds(root);
    s_canvas_layer = layer_create(bounds);
    layer_set_update_proc(s_canvas_layer, canvas_update_proc);
    layer_add_child(root, s_canvas_layer);
}

static void window_unload(Window *window) {
    layer_destroy(s_canvas_layer);
}

// --- Init / Deinit -------------------------------------------
static void init(void) {
    #if DEBUG_ICS
    APP_LOG(APP_LOG_LEVEL_INFO, "DEBUG ICS MODE ACTIVE");
    s_event_count = 4;
    
    // Event 1
    s_events[0].start_mins = 14 * 60;
    s_events[0].duration_mins = 60;
    s_events[0].cal_index = 0;
    s_events[0].all_day = false;
    
    snprintf(s_event_text[0], sizeof(s_event_text[0]),
           "A veeeery long and boring Meeting that takes the whole day");
    s_event_cal[0] = 0;
    
    // Event 2
    s_events[1].start_mins = 15.5 * 60;
    s_events[1].duration_mins = 120;
    s_events[1].cal_index = 1;
    s_events[1].all_day = false;
    
    snprintf(s_event_text[1], sizeof(s_event_text[1]),
           "Workout");
    s_event_cal[1] = 1;
  
    // Event 3
    s_events[2].start_mins = 7 * 60;
    s_events[2].duration_mins =300;
    s_events[2].cal_index = 2;
    s_events[2].all_day = false;
    
    snprintf(s_event_text[2], sizeof(s_event_text[2]),
           "Coffee");
    s_event_cal[2] = 2;
  
    // Event 4
    s_events[3].start_mins = 12 * 60;
    s_events[3].duration_mins = 45;
    s_events[3].cal_index = 3;
    s_events[3].all_day = false;
    
    #endif
    s_small_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    s_date_font  = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
    s_rainbow_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMG_RAINBOW_HAND);
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers){
        .load   = window_load,
        .unload = window_unload
    });
    window_stack_push(s_window, true);
    //tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
    update_tick_subscription();
    app_message_register_inbox_received(inbox_received_handler);
    app_message_register_inbox_dropped(inbox_dropped_handler);
    app_message_open(512, 512);
    battery_state_service_subscribe(battery_callback);
    
    BatteryChargeState state = battery_state_service_peek();
    battery_callback(state);
}

static void deinit(void) {
    tick_timer_service_unsubscribe();
    window_destroy(s_window);
    gbitmap_destroy(s_rainbow_bitmap);
    battery_state_service_unsubscribe();
}

int main(void) {
    init();
    app_event_loop();
    deinit();
    return 0;
}