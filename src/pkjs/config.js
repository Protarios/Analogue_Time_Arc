// Clay configuration, bundled with the watchface (no hosted HTML page).
// The palette indexes intentionally match s_palette_argb[] in src/c/watchface.c.
var PALETTE = [
  ['Turquoise', '00FFAA'],
  ['Lime', '55FF00'],
  ['Cyan', '00FFFF'],
  ['Blue', '0055FF'],
  ['Lavender', 'AAAAFF'],
  ['Violet', 'AA00FF'],
  ['Magenta', 'FF55FF'],
  ['Red', 'FF0000'],
  ['Coral', 'FF5555'],
  ['Orange', 'FFAA00'],
  ['Yellow', 'FFFF00'],
  ['White', 'FFFFFF'],
  ['Light gray', 'AAAAAA'],
  ['Dark gray', '555555'],
  ['Indigo', '5500AA'],
  ['Neon green', '00FF00']
];
var DEFAULT_CAL_COLORS = [0, 4, 8, 2, 9, 5, 1, 7, 10, 3];
var COLOR_LAYOUT = [
  PALETTE.slice(0,4).map(function(c) { return c[1]; }),
  PALETTE.slice(4,8).map(function(c) { return c[1]; }),
  PALETTE.slice(8,12).map(function(c) { return c[1]; }),
  PALETTE.slice(12,16).map(function(c) { return c[1]; })
];
function colorField(messageKey, label, index) {
  return { type: 'color', messageKey: messageKey, label: label,
    defaultValue: PALETTE[index][1], sunlight: false, layout: COLOR_LAYOUT };
}

var COMPLICATION_OPTIONS = [
  { value: '0', label: 'Empty / Leer' },
  { value: '1', label: 'Date: large day / Datum groß' },
  { value: '7', label: 'Date: large DD.MM / Datum mit Monat groß' },
  { value: '2', label: 'Battery / Batterie' },
  { value: '3', label: 'Weather / Wetter' },
  { value: '4', label: 'Calendar week: large / KW groß' },
  { value: '5', label: 'Seconds / Sekunden' },
  { value: '6', label: 'Swatch Internet Time / .beat' }
];
var config = [
  { type: 'heading', defaultValue: 'Analogue Time Arc' },
  { type: 'text', defaultValue: 'Settings are stored on your phone. No external configuration website is required.' },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Display' },
    { type: 'toggle', messageKey: 'TemperatureUnit', label: 'Temperature in Fahrenheit', defaultValue: false },

    { type: 'select', messageKey: 'TickMode', label: 'Hour/minute marks / Zifferblattmarkierungen',
      defaultValue: '1', options: [
        { label: 'None / Keine', value: '0' },
        { label: 'Hours only / Nur Stunden', value: '1' },
        { label: 'Hours + fine minute marks / Stunden und feine Minuten', value: '2' }
      ] },
    colorField('TickColor', 'Outer hour marks / Ziffernfarbe', 11),
    colorField('CenterColor', 'Center pivot / Zeigermittelpunkt', 11),
    { type: 'toggle', messageKey: 'ShowSeconds', label: 'Show seconds hand', defaultValue: true },
    { type: 'toggle', messageKey: 'OverlayAboveHands', label: 'Appointment location and titles above hands', defaultValue: false },
    { type: 'input', messageKey: 'LocationPrefix',
      label: 'Appointment location prefix / Ortspräfix', defaultValue: 'Ort: ',
      attributes: { placeholder: 'Ort:  /  @  /  (empty)' } },
    { type: 'select', messageKey: 'BatteryStyle', label: 'Battery appearance / Batteriedarstellung',
      defaultValue: '0', options: [
        { label: 'Percentage / Prozent', value: '0' },
        { label: 'Colored battery icon / Farbiges Batteriesymbol', value: '1' }
      ] },
    { type: 'select', messageKey: 'BatteryDisplayMode', label: 'Battery display / Batterieanzeige',
      defaultValue: '20', options: [
        { label: 'Always / Immer', value: '0' },
        { label: 'At or below 10%', value: '10' },
        { label: 'At or below 20%', value: '20' },
        { label: 'At or below 25%', value: '25' },
        { label: 'At or below 50%', value: '50' }
      ] }
  ] },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Complications / Komplikationen' },
    { type: 'select', messageKey: 'LeftComplication', label: 'Left / Links',
      defaultValue: '1', options: COMPLICATION_OPTIONS },
    { type: 'select', messageKey: 'RightComplication', label: 'Right / Rechts',
      defaultValue: '3', options: COMPLICATION_OPTIONS },
    { type: 'select', messageKey: 'TopComplication', label: 'Top / Oben',
      defaultValue: '2', options: COMPLICATION_OPTIONS },
    { type: 'text', defaultValue: 'Appointment location temporarily replaces the top complication according to the existing location priority.' }
  ] },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Hour hand' },
    { type: 'select', messageKey: 'HourHandStyle', label: 'Style', defaultValue: '0',
      options: [
        { label: 'Classic (original)', value: '0' },
        { label: 'Minimalin (bold)', value: '1' }
      ] },
    { type: 'select', messageKey: 'HourHandLength', label: 'Hour hand length / Stundenzeigerlänge', defaultValue: '0', options: [
        { label: 'Short (previous bold length)', value: '0' },
        { label: 'Medium', value: '1' },
        { label: 'Long (near dial edge)', value: '2' }
      ] },
    colorField('HourHandColor', 'Color', 11)
  ] },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Minute hand' },
    { type: 'select', messageKey: 'MinuteHandStyle', label: 'Style', defaultValue: '0',
      options: [
        { label: 'Classic (original)', value: '0' },
        { label: 'Minimalin (bold)', value: '1' },
        { label: 'Minimalin Rainbow', value: '2' }
      ] },
    { type: 'select', messageKey: 'MinuteHandLength', label: 'Minute hand length / Minutenzeigerlänge', defaultValue: '0', options: [
        { label: 'Short (previous bold length)', value: '0' },
        { label: 'Medium', value: '1' },
        { label: 'Long (near dial edge)', value: '2' }
      ] },
    colorField('MinuteHandColor', 'Color (not used in Rainbow mode)', 11)
  ] },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Seconds hand / Sekundenzeiger' },
    colorField('SecondsColor', 'Color / Farbe', 7),
    { type: 'select', messageKey: 'SecondsThickness', label: 'Thickness / Strichstärke',
      defaultValue: '1', options: [
        { label: 'Normal (1×, original)', value: '1' },
        { label: 'Double (2×)', value: '2' },
        { label: 'Triple (3×)', value: '3' }
      ] }
  ] }
];

var LABEL_HINTS = [
  'Personal', 'Work', 'Sports', 'Family', 'Travel',
  'Fitness', 'School', 'Social', 'Finance', 'Other'
];

for (var i = 0; i < 10; i++) {
  config.push({ type: 'section', items: [
    { type: 'heading', defaultValue: 'Calendar ' + (i + 1) },
    { type: 'input', messageKey: 'Calendar' + i + 'Label',
      label: 'Calendar name (optional)', defaultValue: '',
      attributes: { placeholder: 'e.g. ' + LABEL_HINTS[i] } },
    { type: 'input', messageKey: 'Calendar' + i + 'Url',
      label: 'ICS subscription URL', defaultValue: '',
      attributes: { type: 'url', placeholder: 'https://example.org/calendar.ics' } },
    colorField('Calendar' + i + 'Color', 'Event/arc color', DEFAULT_CAL_COLORS[i])
  ] });
}
config.push({ type: 'submit', defaultValue: 'Save settings' });

module.exports = config;
