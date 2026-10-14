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
const schemaPalette = ["00FFAA","55FF00","00FFFF","0055FF","AAAAFF","AA00FF","FF55FF","FF0000","FF5555","FFAA00","FFFF00","FFFFFF","AAAAAA","555555","5500AA","00FF00"];
const fields = itemsFromSchema(schema).filter(item => item.messageKey);

test('Clay defines all existing settings and exactly 10 full calendar entries', () => {
  assert.equal(fields.length, 49);
  const keys = fields.map(item => item.messageKey);
  assert.equal(new Set(keys).size, keys.length);
  for (let i = 0; i < 10; ++i) {
    assert.ok(keys.includes('Calendar' + i + 'Label'));
    assert.ok(keys.includes('Calendar' + i + 'Url'));
    assert.ok(keys.includes('Calendar' + i + 'Color'));
    const color = fields.find(item => item.messageKey === 'Calendar'+i+'Color');
    assert.equal(color.type, 'color');
    assert.equal(color.defaultValue, schemaPalette[defaults[i]]);
    assert.equal(color.layout.flat().length, 16);
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
    assert.equal(app.clay.settings['Calendar'+i+'Color'],schemaPalette[saved['color'+i]]);
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
  settings.HourHandColor.value=schemaPalette[9];
  settings.MinuteHandColor.value=schemaPalette[12];
  settings.OverlayAboveHands.value=true;
  settings.Calendar0Url.value='https://example.com/personal.ics';
  settings.Calendar0Label.value='Personal';
  settings.Calendar0Color.value=schemaPalette[7];
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
  assert.equal(fields.some(x => x.messageKey === 'ShowNextLocation'), false);
  const battery = fields.find(x => x.messageKey === 'BatteryDisplayMode');
  assert.deepEqual(battery.options.map(x => x.value), ['0','10','20','25','50']);
  assert.match(fields.find(x => x.messageKey === 'HourHandLength').label, /Hour hand length/);
  assert.match(fields.find(x => x.messageKey === 'MinuteHandLength').label, /Minute hand length/);
});

test('battery-mode presets are configurable', () => {
  const battery = fields.find(x => x.messageKey === 'BatteryDisplayMode');
  assert.ok(battery);
  assert.equal(battery.defaultValue, '20');
});

test('outer hour tick color uses a separate Clay setting', () => {
  const tick = fields.find(x => x.messageKey === 'TickColor');
  assert.ok(tick);
  assert.equal(tick.type, 'color');
  assert.equal(tick.defaultValue, 'FFFFFF');
  assert.ok(tick.layout.flat().includes('00FF00'));
});

test('independent central pivot color is configurable', () => {
  const field = fields.find(x => x.messageKey === 'CenterColor');
  assert.ok(field);
  assert.equal(field.type, 'color');
  assert.equal(field.defaultValue, 'FFFFFF');
  assert.match(field.label, /Zeigermittelpunkt/);
  assert.ok(js.includes('63: validOption(config.centerColor, 11, 15)'));
});

test('color grid selection round-trips through old numeric app messages', () => {
  const app=sandbox({hourColor:7,centerColor:11,color0:14});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.HourHandColor, 'FF0000');
  assert.equal(app.clay.settings.Calendar0Color, '5500AA');
  const settings={};
  for(const f of fields) settings[f.messageKey]={value:app.clay.settings[f.messageKey] ?? f.defaultValue};
  settings.HourHandColor.value='00FF00';
  settings.Calendar0Color.value='#FFAA00';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.hourColor,15);
  assert.equal(saved.color0,9);
  assert.equal(app.sent[0][12],15);
});

test('Clay color picker RGB24 values survive saving for all colors', () => {
  const app=sandbox({hourColor:11,minuteColor:11,centerColor:11,tickColor:11});
  app.events.showConfiguration();
  const settings={};
  for(const f of fields) settings[f.messageKey]={value:app.clay.settings[f.messageKey] ?? f.defaultValue};
  settings.HourHandColor.value=0xFF0000;   // Color picker emits 16711680
  settings.MinuteHandColor.value=0x00FF00;
  settings.CenterColor.value=0xFFFFFF;
  settings.TickColor.value=0x0055FF;
  settings.Calendar0Color.value=0xFFFF00;
  settings.Calendar1Color.value=0x555555; // all-digit hex value
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.hourColor,7);
  assert.equal(saved.minuteColor,15);
  assert.equal(saved.centerColor,11);
  assert.equal(saved.tickColor,3);
  assert.equal(saved.color0,10);
  assert.equal(saved.color1,13);
  assert.equal(app.sent[0][12],7);
  assert.equal(app.sent[0][14],15);
  assert.equal(app.sent[0][62],3);
  assert.equal(app.sent[0][63],11);
  assert.equal(app.sent[0][13].split(',')[0],'10');
  assert.equal(app.sent[0][13].split(',')[1],'13');
});

test('all 16 Clay swatches round-trip as RGB24 colors', () => {
  const app=sandbox({});
  for (let i=0;i<schemaPalette.length;i++) {
    const value=parseInt(schemaPalette[i],16);
    assert.equal(app.context.colorHexToIndex(value,11),i);
    assert.equal(app.context.colorHexToIndex(schemaPalette[i],11),i);
  }
});

test('seconds hand color and relative stroke widths persist and reach watch', () => {
  const color=fields.find(f=>f.messageKey==='SecondsColor');
  const thickness=fields.find(f=>f.messageKey==='SecondsThickness');
  assert.equal(color.type,'color');
  assert.equal(color.defaultValue,'FF0000');
  assert.deepEqual(thickness.options.map(x=>x.value),['1','2','3']);
  const app=sandbox({});
  app.events.showConfiguration();
  const settings={};
  for(const f of fields) settings[f.messageKey]={value:app.clay.settings[f.messageKey]??f.defaultValue};
  settings.SecondsColor.value=0x0055FF;
  settings.SecondsThickness.value='3';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.secondsColor,3);
  assert.equal(saved.secondsThickness,3);
  assert.equal(app.sent[0][64],3);
  assert.equal(app.sent[0][65],3);
});

test('appointment location prefix can be customized and cleared', () => {
  const prefix = fields.find(x => x.messageKey === 'LocationPrefix');
  assert.ok(prefix);
  assert.equal(prefix.defaultValue, 'Ort: ');
  const app = sandbox({locationPrefix:'@ '});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.LocationPrefix, '@ ');
  const values = {};
  for (const field of fields) values[field.messageKey] = {value:app.clay.settings[field.messageKey] ?? field.defaultValue};
  values.LocationPrefix.value = '';
  app.events.webviewclosed({response:JSON.stringify(values)});
  assert.equal(JSON.parse(app.memory.get('calendarConfig')).locationPrefix, '');
  assert.equal(app.sent[0][66], '');
});

test('three independent complication slots preserve legacy defaults', () => {
  const app=sandbox({showDate:true,batteryDisplayMode:20});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.LeftComplication,'1');
  assert.equal(app.clay.settings.RightComplication,'3');
  assert.equal(app.clay.settings.TopComplication,'2');
  for(const key of ['LeftComplication','RightComplication','TopComplication']){
    const field=fields.find(x=>x.messageKey===key);
    assert.ok(field);
    assert.equal(field.options.length,7);
  }
});

test('both side slots offer large date, DD.MM and large calendar week', () => {
  for (const side of ['LeftComplication', 'RightComplication']) {
    const field = fields.find(x => x.messageKey === side);
    const options = field.options;
    assert.ok(options.some(x => x.value === '1' && /large day/.test(x.label)));
    assert.ok(options.some(x => x.value === '7' && /DD.MM/.test(x.label)));
    assert.ok(options.some(x => x.value === '4' && /large/.test(x.label)));
  }
  const app=sandbox({leftComplication:7,rightComplication:4});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.LeftComplication, '7');
  assert.equal(app.clay.settings.RightComplication, '4');
});

test('date-with-month and calendar week retain the large side-slot font', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'src/c/watchface.c'), 'utf8');
  assert.match(source, /snprintf\(value, sizeof\(value\), "KW %s", week\)/);
  assert.match(source, /type == COMP_DATE \|\| type == COMP_DATE_DDMM \|\| type == COMP_WEEK/);
  assert.match(source, /int slot_width = is_round \? 63 : 75;/);
  const options = fields.find(f => f.messageKey === 'LeftComplication').options;
  assert.ok(options.some(o => o.value === '7' && o.label.includes('large DD.MM')));
});
