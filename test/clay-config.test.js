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
  assert.equal(fields.length, 52);
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
  assert.equal(app.clay.settings.LeftComplication, '0');
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
    assert.equal(field.options.length,10);
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
  assert.ok(source.includes('type == COMP_DATE || type == COMP_DATE_DDMM'));
  assert.ok(source.includes('type == COMP_WEEK || type == COMP_SECONDS'));
  assert.ok(source.includes('int wide_width = MIN(is_round ? 63 : 75, centre.x - slot_inset - 2);'));
  const options = fields.find(f => f.messageKey === 'LeftComplication').options;
  assert.ok(options.some(o => o.value === '7' && o.label.includes('large DD.MM')));
});

test('dial has three mark modes with backward-compatible hour-only defaults', () => {
  const marks=fields.find(x => x.messageKey === 'TickMode');
  assert.ok(marks);
  assert.deepEqual(marks.options.map(o => o.value), ['0','1','2']);
  assert.equal(marks.defaultValue, '1');
  const old=sandbox({showTicks:false});
  old.events.showConfiguration();
  assert.equal(old.clay.settings.TickMode,'0');
  const app=sandbox({showTicks:true});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.TickMode,'1');
  const settings={};
  for(const f of fields)settings[f.messageKey]={value:app.clay.settings[f.messageKey] ?? f.defaultValue};
  settings.TickMode.value='2';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.tickMode,2);
  assert.equal(saved.showTicks,true);
  assert.equal(app.sent[0][71],2);
  assert.equal(app.sent[0][8],1);
});

test('battery style is independent of threshold and all complication slots', () => {
  const style=fields.find(f=>f.messageKey==='BatteryStyle');
  assert.ok(style);
  assert.deepEqual(style.options.map(o=>o.value),['0','1']);
  const app=sandbox({batteryDisplayMode:25,topComplication:2,leftComplication:0,rightComplication:3});
  app.events.showConfiguration();
  const settings={};
  for(const f of fields)settings[f.messageKey]={value:app.clay.settings[f.messageKey] ?? f.defaultValue};
  settings.BatteryStyle.value='1';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.batteryStyle,1);
  assert.equal(saved.batteryDisplayMode,25);
  assert.equal(saved.topComplication,2);
  assert.equal(app.sent[0][70],1);
  assert.equal(app.sent[0][60],25);
});

test('minute tick geometry and battery icon drawing use dedicated modes', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.match(source,/minute = 0; minute < 60; minute\+\+/);
  assert.match(source,/!is_hour && s_tick_mode != 2/);
  assert.match(source,/int tick_width = is_hour \? \(is_cardinal \? 4 : 2\) : 1;/);
  assert.match(source,/s_battery_percent <= 20 \? GColorRed/);
  assert.match(source,/s_battery_percent <= 50 \? GColorYellow : GColorBrightGreen/);
  assert.match(source,/draw_battery_icon\(ctx, area\)/);
});

test('DD.MM is accepted by watch receiver for all three slot IDs', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  for(const key of ['lcomp','rcomp','tcomp']) {
    assert.ok(source.includes(key+'->value->int32 <= 9'),
      'DD.MM or Health variant rejected for '+key);
  }
  assert.ok(source.includes('snprintf(value, sizeof(value), "%02d.%02d"'));
});

test('seconds and battery use mirrored compact complication slots', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(source.includes('int compact_width = MIN(is_round ? 44 : 56, wide_width);'));
  assert.ok(source.includes('bounds.size.w - slot_inset - right_width'));
  assert.ok(source.includes('type == COMP_WEEK || type == COMP_SECONDS'));
  assert.ok(source.includes('graphics_text_layout_get_content_size'));
  assert.ok(source.includes('draw_battery_icon(ctx, area)'));
  assert.ok(source.includes('bool wide_left = s_complication_left == COMP_DATE_DDMM'));
  assert.ok(source.includes('bool wide_right = s_complication_right == COMP_DATE_DDMM'));
});

test('health complication options and saved selections work in all slots', () => {
  for(const key of ['LeftComplication','RightComplication','TopComplication']) {
    const options=fields.find(x=>x.messageKey===key).options;
    assert.ok(options.some(o=>o.value==='8' && o.label.includes('Steps')));
    assert.ok(options.some(o=>o.value==='9' && o.label.includes('Heart rate')));
  }
  const app=sandbox({leftComplication:8,rightComplication:9,topComplication:5,showSeconds:false});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.LeftComplication,'8');
  assert.equal(app.clay.settings.RightComplication,'9');
  const settings={};
  for(const field of fields)settings[field.messageKey]={value:app.clay.settings[field.messageKey] ?? field.defaultValue};
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.leftComplication,8);
  assert.equal(saved.rightComplication,9);
  assert.equal(saved.topComplication,5);
  assert.equal(app.sent[0][67],8);
  assert.equal(app.sent[0][68],9);
  assert.equal(app.sent[0][69],5);
});

test('health is gated, weather includes its icon on either side', () => {
  const src=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const metadata=require(path.join(root,'package.json'));
  assert.ok(metadata.pebble.capabilities.includes('health'));
  assert.ok(src.includes('health_service_sum_today(HealthMetricStepCount)'));
  assert.ok(src.includes('health_service_peek_current_value(HealthMetricHeartRateBPM)'));
  assert.ok(src.includes('health_service_metric_accessible('));
  assert.ok(src.includes('health_service_events_subscribe('));
  assert.ok(src.includes('draw_heart_pictogram(ctx, cx, symbol_y)'));
  assert.ok(src.includes('draw_steps_pictogram(ctx, cx, symbol_y)'));
  assert.ok(src.includes('draw_weather_icon(ctx, s_weather_code,'));
  assert.ok(src.includes('cx - 10, area.origin.y + 20, weather_shadow'));
  assert.ok(src.includes('bool left_weather_shadow = show_shadow'));
  assert.ok(src.includes('left_weather_shadow = compute_show_shadow('));
  assert.ok(!src.includes('if (s_complication_right == COMP_WEATHER) {'));
  assert.ok(src.includes('centre.y - 20, left_width, 34'));
  assert.ok(src.includes('centre.y - 20, right_width, 34'));
  for(const key of ['lcomp','rcomp','tcomp'])
    assert.ok(src.includes(key+'->value->int32 <= 9'));
});

test('seconds complications force second tick even if seconds hand is hidden', () => {
  const src=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(src.includes('bool needs_seconds = s_show_seconds ||'));
  assert.ok(src.includes('s_complication_left == COMP_SECONDS'));
  assert.ok(src.includes('s_complication_right == COMP_SECONDS'));
  assert.ok(src.includes('s_complication_top == COMP_SECONDS'));
  assert.ok(src.includes('needs_seconds ? SECOND_UNIT : MINUTE_UNIT'));
});

test('new arc styles default to the prior rounded/calendar-colored rendering', () => {
  const e=fields.find(x=>x.messageKey==='ArcEndStyle');
  const c=fields.find(x=>x.messageKey==='ArcColorMode');
  assert.equal(e.defaultValue,'0');
  assert.equal(c.defaultValue,'0');
  assert.deepEqual(e.options.map(x=>x.value),['0','1']);
  assert.deepEqual(c.options.map(x=>x.value),['0','1','3','4','2']);
  const app=sandbox({color0:4});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.ArcEndStyle,'0');
  assert.equal(app.clay.settings.ArcColorMode,'0');
  const settings={};
  for(const field of fields)settings[field.messageKey]={value:app.clay.settings[field.messageKey]??field.defaultValue};
  settings.ArcEndStyle.value='1';
  settings.ArcColorMode.value='2';
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.arcEndStyle,1);
  assert.equal(saved.arcColorMode,2);
  assert.equal(saved.color0,4);
  assert.equal(app.sent[0][72],1);
  assert.equal(app.sent[0][73],2);
  assert.equal(app.sent[0][13].split(',')[0],'4');
});

test('stable event seed identifies appointments independently from their order', () => {
  const app=sandbox({});
  const e={startTime:1791900000000,endTime:1791903600000,
    calIndex:3,title:'Lecture',startMins:450,durationMins:60};
  const other={...e,title:'Other appointment'};
  assert.equal(app.context.eventColorSeed(e),app.context.eventColorSeed({...e}));
  assert.notEqual(app.context.eventColorSeed(e),app.context.eventColorSeed(other));
  app.context.sendEventsToWatch([e,other]);
  const rows=app.sent[0][5].split('|');
  assert.equal(rows.length,2);
  for(const row of rows) {
    assert.equal(row.split(',').length,6);
    assert.match(row.split(',')[5],/^[0-9]{1,3}$/);
  }
  assert.equal(Number(rows[0].split(',')[5]),app.context.eventColorSeed(e));
});

test('sharp calendar arcs fill a continuous square perimeter without polygons', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(source.includes('s_arc_end_style == 1'));
  assert.ok(source.includes('graphics_fill_radial(ctx, radial, GOvalScaleModeFitCircle,'));
  assert.ok(source.includes('fill_square_calendar_arc(ctx, bounds, centre, stroke_width,'));
  assert.ok(source.includes('fill_square_arc_row('));
  assert.ok(source.includes('graphics_fill_rect(ctx, GRect(run_start, y,'));
  assert.ok(source.includes('int32_t first_angle = (int32_t)start_min * TRIG_MAX_ANGLE / 720'));
  assert.ok(source.includes('int32_t last_angle = (int32_t)end_min * TRIG_MAX_ANGLE / 720'));
  assert.ok(source.includes('span_minutes <= 360'));
  assert.ok(source.includes('span_minutes >= 720'));
  assert.ok(!source.includes('gpath_draw_filled(ctx, s_arc_quad_path)'));
  assert.ok(!source.includes('gpath_create(&quad_info)'));
  assert.ok(!source.includes('GPoint quad_init[4]'));
  assert.ok(source.includes('start, 720'));
  assert.ok(source.includes('0, end'));
});


test('three arc coloring modes keep original palette and support stable variants', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(source.includes('s_arc_color_mode == 1'));
  assert.ok(source.includes('s_arc_color_mode != 2'));
  assert.ok(source.includes('return palette_color(ev->random_color_idx)'));
  assert.ok(source.includes('ev->color_seed % 3'));
  assert.ok(source.includes('s_cal_color_idx[calendar_idx]'));
  assert.ok(source.includes('KEY_ARC_END_STYLE'));
  assert.ok(source.includes('KEY_ARC_COLOR_MODE'));
  assert.ok(source.includes('(uint8_t)((sm * 31 + dm * 17 + ci * 13) & 0xFF)'));
  assert.ok(source.includes('s_events[s_event_count].color_seed = (uint8_t)parse_int(&p)'));
});

test('random arc palette uses the existing bright color choices, not dark shades', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const match=source.match(/s_random_arc_palette\[14\]\s*=\s*\{\s*([^}]+)\}/);
  assert.ok(match, 'Expected explicit palette subset');
  const options=match[1].split(',').map(s=>Number(s.trim())).filter(Number.isFinite);
  assert.equal(options.length,14);
  assert.deepEqual([...new Set(options)].sort((a,b)=>a-b),
                   [0,1,2,3,4,5,6,7,8,9,10,11,12,15]);
  assert.ok(!options.includes(13) && !options.includes(14));
  assert.ok(source.includes('score += 100 * arc_rgb_contrast(rgb, previous)'));
  assert.ok(source.includes('score += 35 * arc_rgb_contrast(rgb, earlier)'));
  assert.ok(source.includes('arc_event_before(&s_events[current], &s_events[order[j - 1]])'));
  assert.ok(source.includes('assign_random_arc_colors();'));
  assert.ok(source.includes('ev->random_color_idx = s_random_arc_palette[best_index]'));
});

test('palette can assign distinct contrasting colors to chronologically adjacent events', () => {
  // Pebble stores RGB as a 2-bit-per-channel value. Exercise the same
  // distance thresholds and permutation with a ten-event schedule.
  const argb=[0xCE,0xDC,0xCF,0xC7,0xEB,0xE3,0xF7,0xF0,
              0xF5,0xF8,0xFC,0xFF,0xEA,0xD5,0xD2,0xCC];
  const palette=[0,1,2,3,4,5,6,7,8,9,10,11,12,15];
  const contrast=(i,j)=>{
    const a=argb[i],b=argb[j];
    const dr=((a>>4)&3)-((b>>4)&3);
    const dg=((a>>2)&3)-((b>>2)&3);
    const db=(a&3)-(b&3);
    return 3*dr*dr+4*dg*dg+2*db*db;
  };
  const seeds=[12,15,12,15,12,15,12,15,12,15];
  const chosen=[];
  for(const seed of seeds) {
    const first=seed%14;
    const previous=chosen.length?chosen[chosen.length-1]:-1;
    const earlier=chosen.length>1?chosen[chosen.length-2]:-1;
    let selected=-1;
    for(let pass=0;pass<2 && selected<0;pass++) {
      for(let j=0;j<14;j++) {
        const candidate=palette[(first+j*5)%14];
        if(previous>=0 && contrast(candidate,previous)<15)continue;
        if(pass===0 && earlier>=0 && contrast(candidate,earlier)<11)continue;
        selected=candidate;break;
      }
    }
    chosen.push(selected);
  }
  assert.equal(chosen.length,10);
  for(let i=0;i<chosen.length;i++) {
    assert.ok(palette.includes(chosen[i]));
    assert.ok(chosen[i]!==13 && chosen[i]!==14);
    if(i)assert.ok(contrast(chosen[i],chosen[i-1])>=15,
      'Adjacent appointment colors must have visible contrast');
  }
});

test('random color options preserve legacy IDs and select full Pebble RGB222 space', () => {
  const mode=fields.find(x=>x.messageKey==='ArcColorMode');
  assert.deepEqual(mode.options.map(x=>x.value),['0','1','3','4','2']);
  const app=sandbox({arcColorMode:4,arcEndStyle:1});
  app.events.showConfiguration();
  assert.equal(app.clay.settings.ArcColorMode,'4');
  const settings={};
  for(const f of fields) settings[f.messageKey]={value:app.clay.settings[f.messageKey]??f.defaultValue};
  app.events.webviewclosed({response:JSON.stringify(settings)});
  const saved=JSON.parse(app.memory.get('calendarConfig'));
  assert.equal(saved.arcColorMode,4);
  assert.equal(app.sent[0][73],4);
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(source.includes('int mode = random_modes[m]'));
  assert.ok(source.includes('return mode == 1 ? 14 : (mode == 3 ? 28 : 63)'));
  assert.ok(source.includes('if (mode == 4) return (uint8_t)(index + 1)'));
  assert.ok(source.includes('r == 3 || g == 3 || b == 3'));
  assert.ok(source.includes('r + g + b >= 5'));
  assert.ok(source.includes('arc_colors->value->int32 <= 4'));
  assert.ok(source.includes('ev->random_bright_rgb'));
  assert.ok(source.includes('ev->random_full_rgb'));
});

test('sharp square perimeter is scanline rasterized and the original round path stays intact', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(source.includes('graphics_fill_radial(ctx, radial, GOvalScaleModeFitCircle,'));
  assert.ok(source.includes('GRect(run_start, y, x - run_start, 1)'));
  assert.ok(source.includes('GRect(run_start, y, to_x - run_start + 1, 1)'));
  assert.ok(source.includes('bounds.origin.x + 1'));
  assert.ok(source.includes('bounds.origin.y + 1'));
  assert.ok(source.includes('outer_left + stroke_width'));
  assert.ok(source.includes('inner_right + 1, outer_right'));
  assert.ok(!source.includes('s_arc_quad_points'));
  assert.ok(!source.includes('perimeter_point_at_angle'));
  assert.ok(!source.includes('gpath_draw_filled'));
});

test('square arc scanline geometry has no internal pixel holes and flat minute cuts', () => {
  // Independent reference rasterization of the wedge test used in C.
  // Any pixel inside the ring and minute wedge must be filled, irrespective
  // of the angle at which adjacent segments would have met.
  const width=200, height=228, stroke=8;
  const cx=100, cy=114;
  const sin=m=>Math.sin(m*Math.PI/360);
  const cos=m=>Math.cos(m*Math.PI/360);
  const included=(x,y,start,end)=>{
    if(end-start>=720)return true;
    const dx=(x-cx)*2+1,dy=(y-cy)*2+1;
    const sx=sin(start),sy=-cos(start);
    const ex=sin(end),ey=-cos(end);
    const first=sx*dy-sy*dx,second=dx*ey-dy*ex;
    return end-start<=360?(first>=0&&second>=0):(first>=0||second>=0);
  };
  const onRing=(x,y)=> x>=1&&x<=width-2&&y>=1&&y<=height-2&&
    (x<=stroke||x>=width-stroke-1||y<=stroke||y>=height-stroke-1);
  for(const [begin,end] of [[510,570],[570,630],[630,700],[700,720],[0,60],[100,660],[0,720]]) {
    const expected=new Set();
    const rendered=new Set();
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++) {
      if(onRing(x,y)&&included(x,y,begin,end))expected.add(x+','+y);
    }
    // Simulate contiguous 1px-high fill_rect runs, not separate polygons.
    for(let y=1;y<height-1;y++) {
      let segments=(y<=stroke||y>=height-stroke-1)
        ? [[1,width-2]] : [[1,stroke],[width-stroke-1,width-2]];
      for(const [x0,x1] of segments) {
        let run=-1;
        for(let x=x0;x<=x1;x++) {
          const covered=included(x,y,begin,end);
          if(covered&&run<0)run=x;
          else if(!covered&&run>=0) {
            for(let q=run;q<x;q++)rendered.add(q+','+y);
            run=-1;
          }
        }
        if(run>=0)for(let q=run;q<=x1;q++)rendered.add(q+','+y);
      }
    }
    assert.ok(expected.size>0);
    assert.equal(rendered.size,expected.size,'Fill coverage for '+begin+'..'+end);
    for(const pixel of expected)assert.ok(rendered.has(pixel),'Hole at '+pixel);
  }
});

test('meeting text stays in central dial, hour digits remain behind it', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const renderer=source.slice(source.indexOf('static void draw_appointment_text('),
                              source.indexOf('static void draw_battery_icon('));
  assert.ok(renderer.includes('int meeting_inset = bounds.size.w / 12;'));
  assert.ok(renderer.includes('if (meeting_inset < 13) meeting_inset = 13;'));
  assert.ok(renderer.includes('bounds.size.w - meeting_inset * 2, 16'));
  assert.ok(source.includes('GTextOverflowModeTrailingEllipsis'));
  assert.ok(source.includes('static void draw_overlay_text('));
  assert.ok(source.includes('graphics_context_set_text_color(ctx, s_bg_color)'));
  assert.ok(renderer.includes('draw_overlay_text(ctx, buf, text_rect,'));
  assert.ok(source.includes('static const int8_t offsets[4][2]'));
  assert.ok(renderer.includes('palette_color(s_cal_color_idx[event_cal])'));
  assert.ok(!renderer.includes('GRect(8, text_y + i * 16, bounds.size.w - 8, 16)'));

  // Both existing overlay modes retain their ordering against the hands:
  // side complications and hour marks are before meeting text; its own
  // location overlay and hour-arc indicator keep their previous positions.
  const body=source.slice(source.indexOf('static void canvas_update_proc('));
  const tick=body.indexOf('    // -- Hour tick marks ');
  const complications=body.indexOf('draw_complication_text(ctx, left_rect');
  const beforeHands=body.indexOf('if (!s_overlay_above_hands)');
  const hands=body.indexOf('draw_clock_hands(ctx, centre, hour_angle');
  const afterHands=body.indexOf('if (s_overlay_above_hands)');
  const indicator=body.indexOf('draw_hour_arc_indicator(ctx, bounds, centre');
  assert.ok(tick >= 0 && tick < complications);
  assert.ok(complications < beforeHands && beforeHands < hands);
  assert.ok(hands < afterHands && afterHands < indicator);
});

test('location wraps into two lines and ellipsizes only after line two', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const text=source.slice(source.indexOf('static void draw_appointment_text('),
                          source.indexOf('static void draw_battery_icon('));
  assert.ok(text.includes('char label[sizeof(s_location_prefix) + sizeof(s_next_location)]'));
  assert.ok(text.includes('int location_inset = bounds.size.w / 6'));
  assert.ok(text.includes('if (location_inset < 26) location_inset = 26'));
  assert.ok(text.includes('bounds.size.w - location_inset * 2, 44'));
  assert.ok(text.includes('draw_overlay_text(ctx, label, location_rect, s_text_color)'));
  assert.ok(source.includes('GTextOverflowModeTrailingEllipsis'));
  assert.ok(source.includes('static const int8_t offsets[4][2]'));
  assert.ok(!text.includes('GRect(4, loc_y, bounds.size.w - 8, 38)'));
});

test('concurrent appointments get distinct inner arcs and reuse lanes after ending', () => {
  const src=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  assert.ok(src.includes('static void assign_arc_overlap_lanes(void)'));
  assert.ok(src.includes('arc_event_before(&s_events[current], &s_events[order[j - 1]])'));
  assert.ok(src.includes('int start = ev->full_start_mins;'));
  assert.ok(src.includes('int end = start + ev->duration_mins;'));
  assert.ok(src.includes('lane_end[lane] > start'));
  assert.ok(src.includes('ev->arc_lane = (uint8_t)lane'));
  assert.ok(src.includes('ev->arc_lane * (arc_stroke + 2)'));
  assert.ok(src.includes('clock_radius + stroke_width - lane_inset'));
  assert.ok(src.includes('stroke_width / 2 + lane_inset'));
  assert.ok(src.includes('const int outer_left = bounds.origin.x + 1 + lane_inset;'));
  assert.ok(src.includes('fill_square_calendar_arc(ctx, bounds, centre, stroke_width,'));
  assert.ok(src.includes('assign_arc_overlap_lanes();'));

  const schedule=items=>{
    const end=Array(10).fill(-Infinity),result=Array(items.length).fill(0);
    const order=items.map((e,i)=>({...e,i})).filter(e=>e.duration>0&&!e.allDay)
      .sort((a,b)=>a.start-b.start || a.id-b.id);
    for(const e of order){
      let lane=0;
      while(lane<9&&end[lane]>e.start)lane++;
      result[e.i]=lane;
      end[lane]=e.start+e.duration;
    }
    return result;
  };
  assert.deepEqual(schedule([
    {id:0,start:540,duration:120}, {id:1,start:600,duration:30},
    {id:2,start:630,duration:60}, {id:3,start:660,duration:45}
  ]),[0,1,1,0]);
  assert.deepEqual(schedule([
    {id:1,start:600,duration:60}, {id:0,start:540,duration:90},
    {id:2,start:610,duration:20}
  ]),[1,0,2]);
  assert.deepEqual(schedule([
    {id:0,start:540,duration:60}, {id:1,start:600,duration:45}
  ]),[0,0]);
  assert.deepEqual(schedule([
    {id:0,start:540,duration:120}, {id:1,start:570,duration:0,allDay:true},
    {id:2,start:550,duration:70}
  ]),[0,0,1]);
});

test('the restored solid arcs and three random modes coexist with the latest overlays', () => {
  const source=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const colors=fields.find(f=>f.messageKey==='ArcColorMode');
  assert.deepEqual(colors.options.map(x=>x.value),['0','1','3','4','2']);
  assert.ok(source.includes('static const int random_modes[3] = { 1, 3, 4 };'));
  assert.ok(source.includes('return mode == 1 ? 14 : (mode == 3 ? 28 : 63)'));
  assert.ok(source.includes('graphics_fill_radial(ctx, radial, GOvalScaleModeFitCircle,'));
  assert.ok(source.includes('fill_square_arc_row('));
  assert.ok(source.includes('const int outer_left = bounds.origin.x + 1 + lane_inset;'));
  assert.ok(source.includes('const int outer_top = bounds.origin.y + 1 + lane_inset;'));
  assert.ok(source.includes('const int outer_right = bounds.origin.x + bounds.size.w - 2 - lane_inset;'));
  assert.ok(source.includes('const int outer_bottom = bounds.origin.y + bounds.size.h - 2 - lane_inset;'));
  assert.ok(source.includes('int outer_radius = clock_radius + stroke_width + stroke_width / 2 - lane_inset;'));
  assert.ok(source.includes('assign_arc_overlap_lanes();'));
  assert.ok(source.includes('draw_overlay_text(ctx, label, location_rect, s_text_color);'));
  assert.ok(source.includes('int meeting_inset = bounds.size.w / 12;'));
  assert.ok(!source.includes('s_arc_quad_path'));
  const metadata=require(path.join(root,'package.json'));
  assert.match(metadata.version, /^1\.17\./);
});

test('meeting margins are halved without changing location wrapping or dial order', () => {
  const src=fs.readFileSync(path.join(root,'src/c/watchface.c'),'utf8');
  const render=src.slice(src.indexOf('static void draw_appointment_text('),
                         src.indexOf('static void draw_battery_icon('));
  assert.ok(render.includes('int meeting_inset = bounds.size.w / 12;'));
  assert.ok(render.includes('if (meeting_inset < 13) meeting_inset = 13;'));
  assert.ok(render.includes('bounds.size.w - meeting_inset * 2, 16'));
  assert.ok(render.includes('int location_inset = bounds.size.w / 6;'));
  assert.ok(render.includes('if (location_inset < 26) location_inset = 26;'));
  assert.ok(render.includes('bounds.size.w - location_inset * 2, 44'));
  assert.ok(render.includes('draw_overlay_text(ctx, buf, text_rect,'));
  assert.ok(render.includes('draw_overlay_text(ctx, label, location_rect, s_text_color)'));
  const draw=src.slice(src.indexOf('static void canvas_update_proc('));
  assert.ok(draw.indexOf('if (!s_overlay_above_hands)') < draw.indexOf('draw_clock_hands(ctx, centre'));
  assert.ok(draw.indexOf('draw_clock_hands(ctx, centre') < draw.indexOf('if (s_overlay_above_hands)'));
});
