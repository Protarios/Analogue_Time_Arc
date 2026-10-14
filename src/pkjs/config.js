// Clay configuration, bundled with the watchface (no hosted HTML page).
// The palette indexes intentionally match s_palette_argb[] in src/c/watchface.c.
var PALETTE = [
  ['Teal', '#00CFA5'], ['Mint', '#55FF00'], ['Cyan', '#00FFFF'],
  ['Blue', '#0055FF'], ['Lavender', '#AAAAFF'], ['Purple', '#AA00FF'],
  ['Pink', '#FF55FF'], ['Red', '#FF0000'], ['Coral', '#FF5555'],
  ['Orange', '#FF8000'], ['Yellow', '#FFFF00'], ['White', '#FFFFFF'],
  ['Light Gray', '#AAAAAA'], ['Dark Gray', '#555555'],
  ['Indigo', '#5500AA'], ['Spring Green', '#00FF55']
];
var DEFAULT_CAL_COLORS = [0, 4, 8, 2, 9, 5, 1, 7, 10, 3];
var COLOR_OPTIONS = PALETTE.map(function(color, index) {
  return { label: color[0] + ' (' + color[1] + ')', value: String(index) };
});

var config = [
  { type: 'heading', defaultValue: 'Analogue Time Arc' },
  { type: 'text', defaultValue: 'Settings are stored on your phone. No external configuration website is required.' },
  { type: 'section', items: [
    { type: 'heading', defaultValue: 'Display' },
    { type: 'toggle', messageKey: 'TemperatureUnit', label: 'Temperature in Fahrenheit', defaultValue: false },
    { type: 'toggle', messageKey: 'ShowDate', label: 'Show date', defaultValue: true },
    { type: 'toggle', messageKey: 'ShowTicks', label: 'Hour tick marks', defaultValue: true },
    { type: 'toggle', messageKey: 'ShowSeconds', label: 'Show seconds hand', defaultValue: true },
    { type: 'toggle', messageKey: 'OverlayAboveHands', label: 'Complications above hands', defaultValue: false },
    { type: 'select', messageKey: 'BatteryDisplayMode', label: 'Battery display / Batterieanzeige',
      defaultValue: '20', options: [
        { label: 'Off / Aus', value: '-1' },
        { label: 'Always / Immer', value: '0' },
        { label: 'At or below 10%', value: '10' },
        { label: 'At or below 20%', value: '20' },
        { label: 'At or below 25%', value: '25' },
        { label: 'At or below 50%', value: '50' }
      ] }
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
    { type: 'select', messageKey: 'HourHandColor', label: 'Color', defaultValue: '11', options: COLOR_OPTIONS }
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
    { type: 'select', messageKey: 'MinuteHandColor', label: 'Color (not used in Rainbow mode)',
      defaultValue: '11', options: COLOR_OPTIONS }
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
    { type: 'select', messageKey: 'Calendar' + i + 'Color',
      label: 'Event/arc color', defaultValue: String(DEFAULT_CAL_COLORS[i]),
      options: COLOR_OPTIONS }
  ] });
}
config.push({ type: 'submit', defaultValue: 'Save settings' });

module.exports = config;
