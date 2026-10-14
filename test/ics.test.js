// Run: node --test test/ics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8');
const context = {
  console: { log() {} },
  Date, Math, JSON,
  setInterval() {},
  Pebble: { addEventListener() {}, sendAppMessage() {}, openURL() {} },
  localStorage: { getItem() { return '{}'; }, setItem() {} },
  require(name) {
    if (name === '@rebble/clay') return class MockClay {
      setSettings() {}
      generateUrl() { return 'data:text/html,Mock'; }
      getSettings() { return {}; }
    };
    if (name === './config') return [];
    throw new Error('Unexpected require: ' + name);
  }
};
vm.createContext(context);
vm.runInContext(source, context);
function parse(ics) {
  const now = new Date(2026, 9, 13, 12, 0);
  const cutoff = new Date(2026, 9, 14, 0, 0);
  return Array.from(context.parseICS(ics, 0, now, cutoff));
}
test('explicit date-only event is marked for text but has no arc', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261013\nDTEND;VALUE=DATE:20261014\nSUMMARY:Holiday\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].durationMins, 0);
  assert.equal(events[0].title, 'Holiday');
});
test('implicit DATE without VALUE parameter is all-day', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART:20261013\nDTEND:20261014\nSUMMARY:Holiday\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
});
test('all-day event without DTEND defaults to one day', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261013\nSUMMARY:Holiday\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].durationMins, 0);
});
test('repeating date-only event remains arc-free on its current occurrence', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261011\nRRULE:FREQ=DAILY;COUNT=5\nSUMMARY:Holiday\nEND:VEVENT');
  assert.equal(events.filter(e => e.allDay && e.durationMins === 0).length, 1);
});
test('timed event retains a 60-minute arc', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART:20261013T140000\nDTEND:20261013T150000\nSUMMARY:Meeting\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, false);
  assert.equal(events[0].durationMins, 60);
});

test('midnight-to-midnight DATE-TIME is also treated as all-day', () => {
  const events = parse('BEGIN:VEVENT\nDTSTART;TZID=Europe/Berlin:20261013T000000\nDTEND;TZID=Europe/Berlin:20261014T000000\nSUMMARY:Holiday\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].durationMins, 0);
});

test('24h time and ICS location survive recurrence/event conversion', () => {
  const events = parse('BEGIN:VEVENT\\nDTSTART:20261013T140000\\nDTEND:20261013T150000\\nSUMMARY:Afternoon\\nLOCATION:Building\\, Room 3\\nEND:VEVENT');
  assert.equal(events.length, 1);
  assert.equal(events[0].fullStartMins, 840);
  assert.equal(events[0].location, 'Building, Room 3');
});
