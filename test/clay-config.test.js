// Run via npm test. No SDK or network needed: mock only the Clay boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const schema = require(path.join(root, 'src/pkjs/config.js'));
const js = fs.readFileSync(path.join(root, 'src/pkjs/index.js'), 'utf8');

function itemsFromSchema(collection) {
  return collection.flatMap(item => item.items ? itemsFromSchema(item.items) : [item]);
}
function sandbox(initialConfig) {
  const memory = new Map();
  if (initialConfig !== undefined) memory.set('calendarConfig', JSON.stringify(initialConfig));
  const events = {}, sent = [], urls = [];
  const localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); }
  };
  class MockClay {
    constructor(config, fn, options) {
      assert.equal(options.autoHandleEvents, false);
      this.config = config;
      this.settings = {};
      MockClay.latest = this;
    }
    setSettings(settings) {
      this.settings = { ...this.settings, ...settings };
      localStorage.setItem('clay-settings', JSON.stringify(this.settings));
    }
    generateUrl() { return 'data:text/html,clay'; }
    getSettings(response, convert) {
      assert.equal(convert, false);
      const settings = JSON.parse(response);
      const stored = Object.fromEntries(Object.entries(settings).map(([k,v]) => [k,v.value]));
      localStorage.setItem('clay-settings', JSON.stringify(stored));
      return settings;
    }
  }
  const context = {
    console: { log() {} }, Date, Math, JSON, Number, String, isFinite,
    setInterval() {},
    Pebble: {
      addEventListener(event, fn) { events[event] = fn; },
      openURL(url) { urls.push(url); },
      sendAppMessage(msg, ok) { sent.push(msg); if (ok) ok(); }
    },
    localStorage,
    navigator: {
      geolocation: {
        getCurrentPosition(success) {
          success({coords:{latitude:50.0, longitude:10.0}});
        }
      }
    },
    XMLHttpRequest: class MockXHR {
      open() {}
      send() {}
    },
    require(name) {
      if (name === '@rebble/clay') return MockClay;
      if (name === './config') return schema;
      throw new Error('Unexpected require: ' + name);
    }
  };
  vm.createContext(context);
  vm.runInContext(js, context);
  return { context, events, sent, urls, memory,
           get clay() { return MockClay.latest; } };
}
const defaults = [0,4,8,2,9,5,1,7,10,3];
const fields = itemsFromSchema(schema).filter(item => item.messageKey);

test('Clay defines all existing settings and exactly 10 full calendar entries', () => {
  assert.equal(fields.length, 43);
  const keys = fields.map(item => item.messageKey);
  assert.equal(new Set(keys).size, keys.length);
  for (let i = 0; i < 10; ++i) {
    assert.ok(keys.includes('Calendar' + i + 'Label'));
    assert.ok(keys.includes('Calendar' + i + 'Url'));
    assert.ok(keys.includes('Calendar' + i + 'Color'));
    const color = fields.find(item => item.messageKey === 'Calendar'+i+'Color');
    assert.equal(color.options.length, 16);
    assert.equal(color.defaultValue, String(defaults[i]));
  }
  assert.equal(schema[schema.length-1].type, 'submit');
});

test('legacy saved values are present when opening built-in Clay', () => {
  const saved = {
    useFahrenheit:true, showDate:false, showTicks:false, showSeconds:false,
    overlayAboveHands:true, batteryWarningOnly:false,
    hourColor:9, minuteColor:3, hourHandStyle:1, minuteHandStyle:2
  };
  for(let i=0;i<10;i++){
    saved['label'+i] = 'Calendar '+i;
    saved['url'+i] = 'https://example.com/'+i+'.ics';
    saved['color'+i] = (i+3)%16;
  }
  const app=sandbox(saved);
  app.events.showConfiguration();
  assert.equal(app.urls[0], 'data:text/html,clay');
  assert.equal(app.clay.settings.TemperatureUnit, true);
  assert.equal(app.clay.settings.ShowDate, false);
  assert.equal(app.clay.settings.HourHandStyle, '1');
  assert.equal(app.clay.settings.MinuteHandStyle, '2');
  for(let i=0;i<10;i++){
    assert.equal(app.clay.settings['Calendar'+i+'Url'],saved['url'+i]);
    assert.equal(app.clay.settings['Calendar'+i+'Color'],String(saved['color'+i]));
  }
  app.events.webviewclosed({response:'CANCELLED'});
  assert.deepEqual(JSON.parse(app.memory.get('calendarConfig')),saved);
});

test('Clay save preserves 10 calendar entries, palette indexes and hand styles', () => {
  const app=sandbox({customFlag:'preserved'});
  app.events.showConfiguration();
  const settings = {};
  for(const field of fields) {
    settings[field.messageKey] = {value:app.clay.settings[field.messageKey] ??
      field.defaultValue};
  }
  settings.HourHandStyle.value='1';
  settings.MinuteHandStyle.value='2';
  settings.HourHandColor.value='9';
  settings.MinuteHandColor.value='12';
  settings.OverlayAboveHands.value=true;
  settings.Calendar0Url.value='https://example.com/personal.ics';
  settings.Calendar0Label.value='Personal';
  settings.Calendar0Color.value='7';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.customFlag,'preserved');
  assert.equal(saved.hourHandStyle,1);
  assert.equal(saved.minuteHandStyle,2);
  assert.equal(saved.hourColor,9);
  assert.equal(saved.minuteColor,12);
  assert.equal(saved.overlayAboveHands,true);
  assert.equal(saved.url0,'https://example.com/personal.ics');
  assert.equal(saved.label0,'Personal');
  assert.equal(saved.color0,7);
  assert.equal(saved.color9,3);
  assert.equal(app.sent[0][24],1);
  assert.equal(app.sent[0][25],2);
  assert.equal(app.sent[0][12],9);
  assert.equal(app.sent[0][14],12);
  assert.equal(app.sent[0][13].split(',').length,10);
});

test('invalid or cancelled Clay payload leaves legacy configuration untouched', () => {
  const saved={url0:'https://example.com/work.ics'};
  const app=sandbox(saved);
  app.events.webviewclosed({response:'CANCELLED'});
  app.events.webviewclosed({response:'not a JSON object'});
  assert.deepEqual(JSON.parse(app.memory.get('calendarConfig')),saved);
  assert.equal(app.sent.length,0);
});

test('Clay configuration is bundled without a legacy hosted settings URL', () => {
  assert.ok(js.includes('Pebble.openURL(settingsPage.generateUrl())'));
  assert.ok(!js.includes('protarios.github.io/pebble-analogue-config'));
  assert.ok(!js.includes('htmlpreview.github.io'));
});

test('PebbleKit startup does not require Clay until settings are opened', () => {
  const events = {};
  const context = {
    console: { log() {} }, Date, Math, JSON,
    setInterval() {},
    Pebble: { addEventListener(name, fn) { events[name] = fn; }, sendAppMessage() {} },
    localStorage: { getItem() { return null; } },
    require() { throw new Error('Clay package not installed'); }
  };
  vm.createContext(context);
  assert.doesNotThrow(() => vm.runInContext(js, context));
  assert.ok(events.ready);
  assert.ok(events.showConfiguration);
  assert.doesNotThrow(() => events.showConfiguration());
});

test('three hand length presets and optional next location are exposed', () => {
  for (const key of ['HourHandLength','MinuteHandLength']) {
    const field = fields.find(x => x.messageKey === key);
    assert.ok(field);
    assert.deepEqual(field.options.map(x => x.value), ['0','1','2']);
  }
  assert.equal(fields.find(x => x.messageKey === 'ShowNextLocation').defaultValue, false);
});
