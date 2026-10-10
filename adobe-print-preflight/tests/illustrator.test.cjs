'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../src/illustrator.jsxinc');
const present = fs.existsSync(sourcePath);
const source = present ? fs.readFileSync(sourcePath, 'utf8') : '';
const enums = { DocumentColorSpace: { RGB: 1, CMYK: 2 }, ImageColorSpace: { RGB: 10, CMYK: 20, GrayScale: 30, DeviceN: 40, Indexed: 50 },
  ColorModel: { PROCESS: 100, REGISTRATION: 200, SPOT: 300 } };
function dom(typename, properties) { return Object.assign({ typename }, properties); }
function artboard(name, artboardRect) { return dom('Artboard', { name, artboardRect }); }
function fixture() {
  return dom('Document', { name: 'Print.ai', documentColorSpace: enums.DocumentColorSpace.CMYK,
    artboards: [artboard('Front', [0, 100, 100, 0])], pageItems: [], textFrames: [], rasterItems: [], placedItems: [], spots: [],
    rasterEffectSettings: { resolution: 300 }, selection: [] });
}
function ink(typename, properties) { return dom(typename, properties); }
function black() { return ink('CMYKColor', { cyan: 0, magenta: 0, yellow: 0, black: 100 }); }
function spot(name, color = black(), colorType = enums.ColorModel.SPOT) { return dom('Spot', { name, color, colorType }); }
function none() { return ink('NoColor', {}); }
function character(fillColor, size = 10, strokeColor = none(), name = 'PrintFont') {
  return dom('Character', { contents: 'A', characterAttributes: { fillColor, strokeColor, size, textFont: dom('TextFont', { name }) } });
}
function textFrame(name, characters, bounds = [20, 80, 80, 20]) {
  return dom('TextFrame', { name, geometricBounds: bounds, visibleBounds: bounds, characters });
}
function pathItem(name, bounds, anchors, properties = {}) {
  return dom('PathItem', Object.assign({ name, geometricBounds: bounds, visibleBounds: bounds, closed: true, stroked: true,
    strokeWidth: 2, strokeColor: black(), filled: false, fillColor: none(),
    pathPoints: anchors.map(anchor => ({ anchor, leftDirection: anchor.slice(), rightDirection: anchor.slice() })) }, properties));
}
function freezeDeep(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) { const d = Object.getOwnPropertyDescriptor(value, key); if ('value' in d) freezeDeep(d.value, seen); }
  return Object.freeze(value);
}
function run(doc) {
  const context = vm.createContext(Object.assign({}, enums));
  vm.runInContext(source, context, { filename: sourcePath });
  return JSON.parse(JSON.stringify(context.collectIllustrator(doc)));
}
function notice(snapshot, pattern) { return snapshot.extra.some(x => pattern.test(x.message)); }
function coverage(snapshot, pattern) { return snapshot.coverage.some(x => pattern.test(x)); }

test('exposes the missing Illustrator collector', () => {
  assert.ok(present, 'Illustrator collector implementation is missing');
  const context = vm.createContext(Object.assign({}, enums));
  vm.runInContext(source, context);
  assert.equal(typeof context.collectIllustrator, 'function');
});

test('converts Illustrator artboard coordinates to top-down points and does not read or change selection', { skip: !present }, () => {
  const doc = fixture(); doc.artboards.push(artboard('Back', [-200, -50, -100, -150]));
  Object.defineProperty(doc, 'selection', { get() { throw new Error('selection must not be accessed'); }, set() { throw new Error('selection must not be changed'); } });
  const out = run(freezeDeep(doc));
  assert.equal(out.host, 'Illustrator'); assert.equal(out.documentName, 'Print.ai');
  assert.deepEqual(out.pages, [
    { label: 'Front', boundsPt: [-100, 0, 0, 100], bleedPt: null },
    { label: 'Back', boundsPt: [50, -200, 150, -100], bleedPt: null }
  ]);
  assert.ok(coverage(out, /도련/));
});

test('assigns an object to every intersecting artboard and leaves off-artboard work unassigned', { skip: !present }, () => {
  const doc = fixture(); doc.artboards.push(artboard('Back', [100, 100, 200, 0]));
  doc.pageItems = [pathItem('Across', [90, 80, 110, 20], [[90, 80], [110, 80], [110, 20], [90, 20]]),
    pathItem('Pasteboard', [300, 80, 320, 20], [[300, 80], [320, 80], [320, 20], [300, 20]])];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.items.filter(x => x.label === 'Across').map(x => x.pageLabel), ['Front', 'Back']);
  assert.deepEqual(out.items[0].boundsPt, [-80, 90, -20, 110]);
  assert.equal(out.items.find(x => x.label === 'Pasteboard').pageLabel, null);
});

test('keeps artboard assignments distinct when user-defined artboard names repeat', { skip: !present }, () => {
  const doc = fixture(); doc.artboards.push(artboard('Front', [100, 100, 200, 0]));
  doc.textFrames = [textFrame('Back text', [character(black())], [120, 80, 180, 20])];
  const out = run(freezeDeep(doc));
  assert.equal(new Set(out.pages.map(x => x.label)).size, 2);
  assert.equal(out.items[0].pageLabel, out.pages[1].label);
  assert.notEqual(out.items[0].pageLabel, out.pages[0].label);
});

test('only a straight closed rectangle near all four artboard edges is a border candidate', { skip: !present }, () => {
  const doc = fixture();
  doc.pageItems = [
    pathItem('Border', [5, 95, 95, 5], [[5, 95], [95, 95], [95, 5], [5, 5]]),
    pathItem('Rule', [0, 100, 100, 100], [[0, 100], [100, 100]], { closed: false }),
    pathItem('Triangle', [0, 100, 100, 0], [[0, 100], [100, 100], [0, 0]]),
    pathItem('Interior', [20, 80, 80, 20], [[20, 80], [80, 80], [80, 20], [20, 20]]),
    pathItem('No ink', [0, 100, 100, 0], [[0, 100], [100, 100], [100, 0], [0, 0]], { strokeColor: none() }),
    pathItem('Curved', [0, 100, 100, 0], [[0, 100], [100, 100], [100, 0], [0, 0]])
  ];
  doc.pageItems[5].pathPoints[0].rightDirection = [20, 100];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.items.map(x => x.borderCandidate), [true, false, false, false, false, false]);
  assert.equal(out.items[0].strokePt, 2);
});

test('uses visible object bounds for trim distance while matching border corners to geometric bounds', { skip: !present }, () => {
  const doc = fixture(); doc.pageItems = [pathItem('Stroked border', [5, 95, 95, 5], [[5, 95], [95, 95], [95, 5], [5, 5]],
    { visibleBounds: [3, 97, 97, 3], strokeWidth: 4 })];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.items[0].boundsPt, [-97, 3, -3, 97]);
  assert.equal(out.items[0].borderCandidate, true);
});

test('reads every character fill, stroke, and size even when text styles differ inside a frame', { skip: !present }, () => {
  const doc = fixture(); const trueSpot = spot('Intentional spot');
  doc.textFrames = [textFrame('Mixed', [
    character(black(), 8), character(ink('RGBColor', { red: 20, green: 30, blue: 40 }), 12, black(), 'OtherFont'),
    character(ink('GrayColor', { gray: 15 }), 9), character(ink('SpotColor', { spot: trueSpot, tint: 55 }), 11), character(none(), 10)
  ])];
  doc.pageItems = doc.textFrames.slice();
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.texts.map(x => x.sizePt), [8, 12, 9, 11, 10]);
  assert.deepEqual(out.texts.map(x => x.ink.space), ['CMYK', 'RGB', 'Gray', 'Spot', 'None']);
  assert.deepEqual(out.texts[0].ink.values, [0, 0, 0, 100]);
  assert.deepEqual(out.texts[1].ink.values, [20, 30, 40]);
  assert.deepEqual(out.texts[2].ink.values, [15]);
  assert.deepEqual(out.texts[3].ink, { space: 'Spot', values: [55], name: 'Intentional spot' });
  assert.equal(out.texts[1].strokeInk.space, 'CMYK'); assert.equal(out.texts[0].strokeInk.space, 'None');
  assert.equal(out.items[0].kind, 'text'); assert.equal(out.items.length, 1);
  assert.deepEqual(out.fonts, [{ name: 'PrintFont', status: 'unknown', embedAllowed: null }, { name: 'OtherFont', status: 'unknown', embedAllowed: null }]);
  assert.ok(coverage(out, /대체|누락/)); assert.ok(coverage(out, /포함|임베/));
});

test('deduplicates identical adjacent character styles without dropping later ink changes', { skip: !present }, () => {
  const doc = fixture(); doc.textFrames = [textFrame('Runs', [character(black()), character(black()),
    character(ink('RGBColor', { red: 0, green: 0, blue: 0 })), character(black())])];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.texts.map(x => x.ink.space), ['CMYK', 'RGB', 'CMYK']);
});

test('never substitutes raster effect resolution or undocumented effectivePpi for placed image resolution', { skip: !present }, () => {
  const doc = fixture(); doc.rasterItems = [dom('RasterItem', { name: 'CMYK raster', geometricBounds: [10, 90, 90, 10],
    imageColorSpace: enums.ImageColorSpace.CMYK, effectivePpi: [300, 300], resolution: 300 }),
    dom('RasterItem', { name: 'Gray raster', geometricBounds: [10, 90, 90, 10], imageColorSpace: 'ImageColorSpace.GrayScale' }),
    dom('RasterItem', { name: 'Unknown raster', geometricBounds: [10, 90, 90, 10], imageColorSpace: enums.ImageColorSpace.Indexed })];
  doc.pageItems = doc.rasterItems.slice();
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.images.map(x => x.ppi), [null, null, null]);
  assert.deepEqual(out.images.map(x => x.space), ['CMYK', 'Gray', 'Unknown']);
  assert.ok(notice(out, /해상도|PPI/)); assert.ok(coverage(out, /해상도|PPI/));
});

test('keeps placed raster color unknown and does not count EPS, PDF, or SVG as certified raster images', { skip: !present }, () => {
  const doc = fixture(); doc.placedItems = ['photo.tif', 'logo.eps', 'cover.PDF', 'art.svg'].map(name => dom('PlacedItem', {
    name, file: { name }, geometricBounds: [10, 90, 90, 10], imageColorSpace: 'CMYK', effectivePpi: [300, 300] }));
  doc.pageItems = doc.placedItems.slice();
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.images, [{ label: 'photo.tif', ppi: null, space: 'Unknown' }]);
  assert.deepEqual(out.items.map(x => x.kind), ['image', 'other', 'other', 'other']);
  assert.ok(notice(out, /PDF|EPS|SVG/));
});

test('preserves spot swatches with unknown usage and flags RGB document mode separately', { skip: !present }, () => {
  const doc = fixture(); doc.documentColorSpace = enums.DocumentColorSpace.RGB;
  doc.spots = [spot('Unused spot')];
  doc.textFrames = [textFrame('CMYK text', [character(black())])];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.spots, [{ name: 'Unused spot', used: null }]);
  assert.equal(out.texts[0].ink.space, 'CMYK');
  assert.ok(notice(out, /RGB.*문서|문서.*RGB/));
  assert.ok(!out.extra.some(x => x.severity === '주의' && /Unused spot/.test(x.message)));
});

test('reports actual RGB vector colors even in a CMYK document', { skip: !present }, () => {
  const doc = fixture(); doc.pageItems = [pathItem('RGB shape', [10, 90, 90, 10], [[10, 90], [90, 90], [90, 10], [10, 10]],
    { filled: true, fillColor: ink('RGBColor', { red: 12, green: 34, blue: 56 }) })];
  const out = run(freezeDeep(doc));
  assert.ok(notice(out, /RGB shape.*RGB/));
  assert.ok(!notice(out, /RGB.*문서.*모드/));
});

test('locates an actual spot path fill while preserving swatch usage as unknown', { skip: !present }, () => {
  const doc = fixture(); const varnish = spot('Varnish');
  doc.pageItems = [pathItem('Varnish logo', [10, 90, 90, 10], [[10, 90], [90, 90], [90, 10], [10, 10]],
    { filled: true, fillColor: ink('SpotColor', { spot: varnish, tint: 100 }) })];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.spots, [{ name: 'Varnish', used: null }]);
  assert.ok(out.extra.some(x => x.severity === '확인 필요' && /Varnish logo.*Varnish/.test(x.message)));
});

test('reports inaccessible object collections rather than implying all artwork was inspected', { skip: !present }, () => {
  const doc = fixture(); Object.defineProperty(doc, 'pageItems', { get() { throw new Error('unreadable collection'); } });
  const out = run(freezeDeep(doc));
  assert.ok(notice(out, /객체.*읽|pageItems/));
});

test('records gradients, patterns, meshes, symbols, and inaccessible colors as manual checks', { skip: !present }, () => {
  const doc = fixture();
  doc.pageItems = [pathItem('Gradient', [10, 90, 90, 10], [[10, 90], [90, 90], [90, 10], [10, 10]],
    { filled: true, fillColor: ink('GradientColor', {}) }),
    pathItem('Pattern', [10, 90, 90, 10], [[10, 90], [90, 90], [90, 10], [10, 10]], { filled: true, fillColor: ink('PatternColor', {}) }),
    dom('MeshItem', { name: 'Mesh', geometricBounds: [10, 90, 90, 10] }),
    dom('SymbolItem', { name: 'Symbol', geometricBounds: [10, 90, 90, 10] })];
  const bad = character(black()); Object.defineProperty(bad.characterAttributes, 'fillColor', { get() { throw new Error('unreadable ink'); } });
  doc.textFrames = [textFrame('Unreadable', [bad])];
  const out = run(freezeDeep(doc));
  assert.equal(out.texts[0].ink.space, 'Unknown');
  assert.ok(notice(out, /그라디언트|Gradient/)); assert.ok(notice(out, /패턴|Pattern/));
  assert.ok(notice(out, /Mesh|메시/)); assert.ok(notice(out, /Symbol|심볼/));
  assert.ok(notice(out, /Unreadable|읽|색상/));
});

test('caps character scanning and explicitly reports the uninspected remainder', { skip: !present }, () => {
  const doc = fixture(); const chars = Array.from({ length: 30001 }, () => character(black()));
  Object.defineProperty(chars[30000], 'characterAttributes', { get() { throw new Error('outside the cap'); } });
  doc.textFrames = [textFrame('Long text', chars)];
  const out = run(freezeDeep(doc));
  assert.ok(notice(out, /30000|30,000/)); assert.ok(notice(out, /나머지|제한|일부/));
});

test('resolves a global process K100 swatch at 5 percent to CMYK K5 rather than a spot plate', { skip: !present }, () => {
  const doc = fixture(); const globalBlack = spot('Global Black', black(), enums.ColorModel.PROCESS);
  doc.spots = [globalBlack]; doc.textFrames = [textFrame('Faint type', [character(ink('SpotColor', { spot: globalBlack, tint: 5 }))])];
  const out = run(freezeDeep(doc));
  assert.equal(out.texts[0].ink.space, 'CMYK');
  assert.deepEqual(out.texts[0].ink.values, [0, 0, 0, 5]);
  assert.deepEqual(out.spots, []);
});

test('applies global process RGB tint toward white and leaves unverified Gray polarity manual', { skip: !present }, () => {
  const doc = fixture(); const rgb = spot('Global RGB', ink('RGBColor', { red: 0, green: 100, blue: 200 }), enums.ColorModel.PROCESS);
  const gray = spot('Global Gray', ink('GrayColor', { gray: 80 }), enums.ColorModel.PROCESS);
  const nested = spot('Nested Process', ink('SpotColor', { spot: gray, tint: 50 }), enums.ColorModel.PROCESS);
  doc.textFrames = [textFrame('Tinted', [character(ink('SpotColor', { spot: rgb, tint: 50 })),
    character(ink('SpotColor', { spot: gray, tint: 25 })), character(ink('SpotColor', { spot: nested, tint: 50 }))])];
  const out = run(freezeDeep(doc));
  assert.equal(out.texts[0].ink.space, 'RGB'); assert.deepEqual(out.texts[0].ink.values, [127.5, 177.5, 227.5]);
  assert.equal(out.texts[1].ink.space, 'Unknown'); assert.deepEqual(out.texts[1].ink.values, []);
  assert.ok(notice(out, /Global Gray.*틴트|프로세스.*Global Gray/));
  assert.ok(notice(out, /Nested Process.*틴트|프로세스.*Nested Process/));
  assert.deepEqual(out.spots, []);
});

test('only inventories true spot plates while registration ink remains unknown with a warning', { skip: !present }, () => {
  const doc = fixture(); const varnish = spot('Varnish'); const process = spot('Global Process', black(), enums.ColorModel.PROCESS);
  const registration = spot('[Registration]', ink('CMYKColor', { cyan: 100, magenta: 100, yellow: 100, black: 100 }), enums.ColorModel.REGISTRATION);
  doc.spots = [process, varnish, registration];
  doc.textFrames = [textFrame('Registration type', [character(ink('SpotColor', { spot: registration, tint: 100 })),
    character(ink('SpotColor', { spot: varnish, tint: 50 }))])];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.spots, [{ name: 'Varnish', used: null }]);
  assert.equal(out.texts[0].ink.space, 'Unknown'); assert.equal(out.texts[1].ink.space, 'Spot');
  assert.ok(out.extra.some(x => x.severity === '주의' && /Registration|레지스트/.test(x.message)));
});

test('never treats an unreadable colorType or invalid process tint as a certified process or spot color', { skip: !present }, () => {
  const doc = fixture(); const unknown = dom('Spot', { name: 'Unclassified', color: black() });
  const invalid = spot('Invalid tint', black(), enums.ColorModel.PROCESS);
  doc.spots = [unknown]; doc.textFrames = [textFrame('Unknown model', [character(ink('SpotColor', { spot: unknown, tint: 100 })),
    character(ink('SpotColor', { spot: invalid, tint: 150 }), 11)])];
  const out = run(freezeDeep(doc));
  assert.deepEqual(out.spots, []);
  assert.deepEqual(out.texts.map(x => x.ink.space), ['Unknown', 'Unknown']);
  assert.ok(notice(out, /Unclassified|colorType|색상 모델/));
  assert.ok(notice(out, /농도|틴트|tint/));
});

test('always leaves Illustrator image coverage incomplete even when no images are discovered', { skip: !present }, () => {
  const out = run(freezeDeep(fixture()));
  assert.equal(out.imageCoverageComplete, false);
});
