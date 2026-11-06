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
  const events = parse([
    'BEGIN:VEVENT',
    'DTSTART:20261013T140000',
    'DTEND:20261013T150000',
    'SUMMARY:Afternoon',
    'LOCATION:Building\\, Room 3',
    'END:VEVENT'
  ].join('\n'));
  assert.equal(events.length, 1);
  assert.equal(events[0].fullStartMins, 840);
  assert.equal(events[0].location, 'Building, Room 3');
});


test('tomorrow morning does not appear tonight at the same 12-hour dial position', () => {
  const now = new Date(2026, 9, 13, 20, 15);
  const cutoff = new Date(2026, 9, 14, 8, 15);
  const raw = [
    'BEGIN:VEVENT', 'DTSTART:20261014T080000', 'DTEND:20261014T090000',
    'SUMMARY:Tomorrow morning', 'END:VEVENT'
  ].join('\n');
  const events = context.parseICS(raw, 0, now, cutoff);
  assert.equal(events.length, 0);
});

test('today late appointment still appears when the horizon crosses midnight', () => {
  const now = new Date(2026, 9, 13, 20, 15);
  const cutoff = new Date(2026, 9, 14, 8, 15);
  const raw = [
    'BEGIN:VEVENT', 'DTSTART:20261013T223000', 'DTEND:20261013T233000',
    'SUMMARY:Tonight', 'END:VEVENT'
  ].join('\n');
  const events = context.parseICS(raw, 0, now, cutoff);
  assert.equal(events.length, 1);
  assert.equal(events[0].fullStartMins, 22 * 60 + 30);
});

test('appointment starting tonight and ending after midnight stays visible', () => {
  const now = new Date(2026, 9, 13, 23, 45);
  const cutoff = new Date(2026, 9, 14, 11, 45);
  const raw = [
    'BEGIN:VEVENT', 'DTSTART:20261013T233000', 'DTEND:20261014T003000',
    'SUMMARY:Overnight', 'END:VEVENT'
  ].join('\n');
  const events = context.parseICS(raw, 0, now, cutoff);
  assert.equal(events.length, 1);
});

test('expired yearly RRULE COUNT=1 or 3 from 2020 cannot create events in 2026', () => {
  const now = new Date(2026, 10, 6, 9, 0), cutoff = new Date(2026, 10, 6, 21, 0);
  function yearly(count) {
    return ['BEGIN:VCALENDAR','BEGIN:VEVENT',
      'DTSTART:20201106T100000','DTEND:20201106T110000',
      'RRULE:FREQ=YEARLY;COUNT='+count,
      'SUMMARY:Expired historical appointment','END:VEVENT','END:VCALENDAR'].join('\n');
  }
  for(const count of [1,2,3,6])
    assert.equal(context.parseICS(yearly(count),0,now,cutoff).length,0);
  const seventh=context.parseICS(yearly(7),0,now,cutoff);
  assert.equal(seventh.length,1);
  assert.equal(seventh[0].title,'Expired historical appointment');
  assert.equal(seventh[0].startTime,new Date(2026,10,6,10,0).getTime());
});

test('COUNT consumes historical daily and weekly occurrences before fetch window', () => {
  const now=new Date(2026,10,6,9,0),cutoff=new Date(2026,10,6,21,0);
  const build=(start,end,rule)=>['BEGIN:VEVENT','DTSTART:'+start,'DTEND:'+end,
    'RRULE:'+rule,'SUMMARY:Recurrence','END:VEVENT'].join('\n');
  const daily=build('20261101T100000','20261101T110000','FREQ=DAILY;COUNT=3');
  assert.equal(context.parseICS(daily,0,now,cutoff).length,0);
  const weekly=build('20261030T100000','20261030T110000','FREQ=WEEKLY;BYDAY=MO,FR;COUNT=2');
  assert.equal(context.parseICS(weekly,0,now,cutoff).length,0);
  const valid=build('20261030T100000','20261030T110000','FREQ=WEEKLY;BYDAY=MO,FR;COUNT=3');
  assert.equal(context.parseICS(valid,0,now,cutoff).length,1);
});

test('cancelled VEVENTs are excluded, confirmed and genuinely repeating events remain', () => {
  const now=new Date(2026,10,6,9,0), cutoff=new Date(2026,10,6,21,0);
  const vevent=(status,rule,start='20261106T100000',end='20261106T110000')=>
    ['BEGIN:VEVENT','DTSTART:'+start,'DTEND:'+end,
      ...(rule?['RRULE:'+rule]:[]),
      ...(status?['STATUS:'+status]:[]),'SUMMARY:Test appointment','END:VEVENT'].join('\n');
  assert.equal(context.parseICS(vevent('CANCELLED'),0,now,cutoff).length,0);
  assert.equal(context.parseICS(vevent('CANCELLED','FREQ=YEARLY','20201106T100000','20201106T110000'),0,now,cutoff).length,0);
  assert.equal(context.parseICS(vevent('CONFIRMED'),0,now,cutoff).length,1);
  assert.equal(context.parseICS(vevent('','FREQ=YEARLY','20201106T100000','20201106T110000'),0,now,cutoff).length,1);
  assert.equal(context.parseICS(vevent('',null,'20201106T100000','20201106T110000'),0,now,cutoff).length,0);
});
