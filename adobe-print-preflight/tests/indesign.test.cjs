'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../src/indesign.jsxinc');
const present = fs.existsSync(sourcePath);
const source = present ? fs.readFileSync(sourcePath, 'utf8') : '';
const enums = {
  MeasurementUnits: { POINTS: 2054188905 },
  ColorSpace: { CMYK: 1129142603, RGB: 1380401696, GRAY: 1196573017 },
  ColorModel: { PROCESS: 1886548851, SPOT: 1936748404, REGISTRATION: 1919248243 },
  FontStatus: { INSTALLED: 1718831470, NOT_AVAILABLE: 1718832705, SUBSTITUTED: 1718834037, FAUXED: 1718830689, UNKNOWN: 1433299822 },
  LinkStatus: { NORMAL: 1852797549, LINK_MISSING: 1819109747, LINK_OUT_OF_DATE: 1819242340, LINK_EMBEDDED: 1282237028, LINK_INACCESSIBLE: 1818848865 },
  PageSideOptions: { LEFT_HAND: 1818653800, RIGHT_HAND: 1919382632, SINGLE_SIDED: 1970497907 },
  NothingEnum: { NOTHING: 1851876449 },
  CoordinateSpaces: { PASTEBOARD_COORDINATES: 2021224545 }
};
function dom(type, props) { return Object.assign({ reflect: { name: type }, isValid: true }, props); }
function color(space, values, name = 'Ink', model = enums.ColorModel.PROCESS) {
  return dom('Color', { space: enums.ColorSpace[space] || space, model, colorValue: values, name });
}
function none(name = '[None]') { return dom('Swatch', { name }); }
function page(name = '1', side = enums.PageSideOptions.RIGHT_HAND, bounds = [0, 0, 800, 600]) {
  return dom('Page', { name, id: 1, side, bounds });
}
function fixture(pages = [page()]) {
  return dom('Document', {
    name: 'Print.indd', pages, allPageItems: [], allGraphics: [], stories: [], swatches: [], fonts: [], links: [], masterSpreads: [],
    documentPreferences: { facingPages: true, documentBleedTopOffset: 9, documentBleedBottomOffset: 8, documentBleedInsideOrLeftOffset: 7, documentBleedOutsideOrRightOffset: 6 }
  });
}
function frame(type, parentPage, props = {}) {
  return dom(type, Object.assign({ name: type, id: 2, parentPage, geometricBounds: [20, 20, 780, 580], strokeWeight: 0,
    fillColor: none(), fillTint: 100, strokeColor: none(), strokeTint: 100, absoluteHorizontalScale: 100,
    absoluteVerticalScale: 100, absoluteRotationAngle: 0, absoluteShearAngle: 0, overflows: false }, props));
}
function textRange(props = {}) {
  return dom('TextStyleRange', Object.assign({ pointSize: 10, fillColor: color('CMYK', [0, 0, 0, 100], 'Black'),
    fillTint: 100, strokeColor: none(), strokeTint: 100, strokeWeight: 0 }, props));
}
function run(doc, options = {}) {
  let measurementUnit = 'original-units';
  const writes = [];
  const preferences = {};
  Object.defineProperty(preferences, 'measurementUnit', {
    get() { return measurementUnit; },
    set(value) { writes.push(value); if (options.rejectPoints && value === enums.MeasurementUnits.POINTS) throw new Error('unit unavailable'); measurementUnit = value; }
  });
  const context = Object.assign({ app: { scriptPreferences: preferences } }, enums);
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const result = context.collectInDesign(doc);
  return { result: JSON.parse(JSON.stringify(result)), measurementUnit, writes };
}
function hasMessage(snapshot, pattern) { return snapshot.extra.some(x => pattern.test(x.message)); }
function hasCoverage(snapshot, pattern) { return snapshot.coverage.some(x => pattern.test(x)); }

test('exposes the missing InDesign collector', () => {
  assert.ok(present, 'InDesign collector implementation is missing');
  const context = vm.createContext(Object.assign({ app: { scriptPreferences: {} } }, enums));
  vm.runInContext(source, context);
  assert.equal(typeof context.collectInDesign, 'function');
});

test('reads page points and facing-page bleed without touching document settings', { skip: !present }, () => {
  const right = page('R'); const left = page('L', enums.PageSideOptions.LEFT_HAND, [0, -600, 800, 0]); left.id = 3;
  const doc = fixture([right, left]);
  Object.defineProperty(doc, 'viewPreferences', { get() { throw new Error('document preferences must never be accessed'); } });
  Object.freeze(doc); Object.freeze(doc.documentPreferences);
  const { result, measurementUnit, writes } = run(doc);
  assert.equal(result.host, 'InDesign'); assert.equal(result.documentName, 'Print.indd');
  assert.deepEqual(result.pages[0], { label: 'R', boundsPt: [0, 0, 800, 600], bleedPt: [9, 7, 8, 6] });
  assert.deepEqual(result.pages[1].bleedPt, [9, 6, 8, 7]);
  assert.equal(measurementUnit, 'original-units');
  assert.deepEqual(writes, [enums.MeasurementUnits.POINTS, 'original-units']);
});

test('only treats a stroked rectangle close to all four page edges as a border candidate', { skip: !present }, () => {
  const p = page(); const doc = fixture([p]);
  doc.allPageItems = [
    frame('Rectangle', p, { name: 'Border', geometricBounds: [5, 5, 795, 595], strokeWeight: 2, strokeColor: color('CMYK', [0, 0, 0, 100]) }),
    frame('Rectangle', p, { name: 'Interior', strokeWeight: 2, strokeColor: color('CMYK', [0, 0, 0, 100]) }),
    frame('Rectangle', p, { name: 'No ink', geometricBounds: [0, 0, 800, 600], strokeWeight: 2 }),
    frame('GraphicLine', p, { name: 'Rule', geometricBounds: [5, 5, 5, 595], strokeWeight: 2, strokeColor: color('CMYK', [0, 0, 0, 100]) }),
    frame('Oval', p, { name: 'Oval', geometricBounds: [0, 0, 800, 600], strokeWeight: 2, strokeColor: color('CMYK', [0, 0, 0, 100]) })
  ];
  const { result } = run(doc);
  assert.deepEqual(result.items.map(x => x.borderCandidate), [true, false, false, false, false]);
  assert.equal(result.items[0].strokePt, 2); assert.equal(result.items[0].pageLabel, '1');
});

test('does not certify scaled or rotated border stroke measurements', { skip: !present }, () => {
  const p = page(); const doc = fixture([p]);
  doc.allPageItems = [frame('Rectangle', p, { name: 'Scaled', geometricBounds: [5, 5, 795, 595], strokeWeight: 2,
    strokeColor: color('CMYK', [0, 0, 0, 100]), absoluteHorizontalScale: 150 })];
  const { result } = run(doc);
  assert.equal(result.items[0].borderCandidate, false); assert.equal(result.items[0].strokePt, null);
  assert.ok(hasMessage(result, /Scaled/)); assert.ok(hasCoverage(result, /확대|변환|획/));
});

test('collects nested page items and labels text positions as frame candidates', { skip: !present }, () => {
  const p = page(); const doc = fixture([p]);
  doc.allPageItems = [frame('Group', p), frame('TextFrame', p, { name: 'Caption', overflows: true })];
  doc.stories = [dom('Story', { id: 3, overflows: true, textStyleRanges: [textRange()] })];
  const { result } = run(doc);
  assert.equal(result.items.length, 2); assert.equal(result.items[1].kind, 'text');
  assert.ok(hasMessage(result, /넘친|넘침|overset/i)); assert.ok(hasCoverage(result, /프레임/));
  assert.ok(hasCoverage(result, /로고/));
});

test('combines recursive tint swatches and text fill/stroke tint without losing None', { skip: !present }, () => {
  const doc = fixture();
  const tint = dom('Tint', { name: 'Black 50', baseColor: color('CMYK', [0, 0, 0, 100]), tintValue: 50 });
  const nested = dom('Tint', { name: 'Black 25', baseColor: tint, tintValue: 50 });
  doc.stories = [dom('Story', { id: 3, overflows: false, textStyleRanges: [
    textRange({ fillColor: nested, fillTint: 40, strokeColor: tint, strokeTint: 20, strokeWeight: 1 }),
    textRange({ fillColor: none('[없음]'), strokeColor: enums.NothingEnum.NOTHING, strokeWeight: 1 })
  ] })];
  const { result } = run(doc);
  assert.deepEqual(result.texts[0].ink.values, [0, 0, 0, 10]);
  assert.deepEqual(result.texts[0].strokeInk.values, [0, 0, 0, 10]);
  assert.equal(result.texts[1].ink.space, 'None'); assert.equal(result.texts[1].strokeInk.space, 'None');
});

test('tints RGB toward paper white and flags inherited or unreadable tints', { skip: !present }, () => {
  const doc = fixture();
  doc.stories = [dom('Story', { overflows: false, textStyleRanges: [textRange({ fillColor: color('RGB', [0, 100, 200]), fillTint: 50 }),
    textRange({ fillTint: -1 })] })];
  const { result } = run(doc);
  assert.deepEqual(result.texts[0].ink.values, [127.5, 177.5, 227.5]);
  assert.equal(result.texts[1].ink.space, 'Unknown');
  assert.ok(hasMessage(result, /틴트|농도/));
});

test('registration ink is not classified as ordinary CMYK black', { skip: !present }, () => {
  const doc = fixture();
  doc.stories = [dom('Story', { overflows: false, textStyleRanges: [textRange({ fillColor: color('CMYK', [100, 100, 100, 100], '[Registration]', enums.ColorModel.REGISTRATION) })] })];
  const { result } = run(doc);
  assert.equal(result.texts[0].ink.space, 'Unknown');
  assert.ok(hasMessage(result, /레지스트|Registration/i));
});

test('uses effective PPI and graphic color space while marking PDF and EPS unknown', { skip: !present }, () => {
  const doc = fixture();
  doc.allGraphics = [dom('Image', { name: 'Photo', effectivePpi: [150, 300], actualPpi: [300, 600], space: 'RGB' }),
    dom('Image', { name: 'Gray', effectivePpi: [300, 300], space: 'Gray' }),
    dom('PDF', { name: 'PDF artwork' })];
  const { result } = run(doc);
  assert.deepEqual(result.images[0], { label: 'Photo', ppi: [150, 300], space: 'RGB' });
  assert.equal(result.images[1].space, 'Gray'); assert.equal(result.images[2].ppi, null); assert.equal(result.images[2].space, 'Unknown');
  assert.ok(hasCoverage(result, /PDF|EPS/));
});

test('retains spot swatches as usage unknown instead of reporting unused swatches as faults', { skip: !present }, () => {
  const doc = fixture(); doc.swatches = [color('CMYK', [40, 10, 0, 0], 'Unused spot', enums.ColorModel.SPOT)];
  const { result } = run(doc);
  assert.deepEqual(result.spots, [{ name: 'Unused spot', used: null }]);
  assert.ok(!result.extra.some(x => x.severity === '주의' && /Unused spot/.test(x.message)));
});

test('reports missing fonts and missing or changed links with documented embedding permission', { skip: !present }, () => {
  const doc = fixture();
  doc.fonts = [dom('Font', { name: 'Installed', status: enums.FontStatus.INSTALLED, allowPDFEmbedding: false }),
    dom('Font', { name: 'Missing', status: enums.FontStatus.NOT_AVAILABLE, allowPDFEmbedding: true })];
  doc.links = [dom('Link', { name: 'gone.tif', status: enums.LinkStatus.LINK_MISSING }), dom('Link', { name: 'changed.tif', status: enums.LinkStatus.LINK_OUT_OF_DATE })];
  const { result } = run(doc);
  assert.deepEqual(result.fonts, [{ name: 'Installed', status: 'installed', embedAllowed: false }, { name: 'Missing', status: 'missing', embedAllowed: true }]);
  assert.ok(hasMessage(result, /gone\.tif/)); assert.ok(hasMessage(result, /changed\.tif/)); assert.ok(hasMessage(result, /Missing/));
});

test('includes shape RGB fills as findings even when the document has no images or text', { skip: !present }, () => {
  const p = page(); const doc = fixture([p]); doc.allPageItems = [frame('Rectangle', p, { name: 'RGB block', fillColor: color('RGB', [255, 0, 0]) })];
  const { result } = run(doc);
  assert.ok(result.extra.some(x => x.severity === '주의' && /RGB block/.test(x.message) && /RGB/.test(x.message)));
});

test('flags master-page inheritance as manual coverage', { skip: !present }, () => {
  const doc = fixture(); doc.masterSpreads = [dom('MasterSpread', { name: 'A-Master' })];
  const { result } = run(doc);
  assert.ok(hasCoverage(result, /마스터/)); assert.ok(hasMessage(result, /마스터/));
});

test('returns partial evidence and restores units when a DOM collection cannot be read', { skip: !present }, () => {
  const doc = fixture(); Object.defineProperty(doc, 'allPageItems', { get() { throw new Error('unsupported API'); } });
  const { result, measurementUnit } = run(doc);
  assert.equal(measurementUnit, 'original-units'); assert.equal(result.pages.length, 1);
  assert.ok(hasMessage(result, /allPageItems|페이지 객체/)); assert.ok(result.extra.some(x => x.severity === '확인 필요'));
});

test('does not reinterpret document-unit geometry as points if setting the script unit fails', { skip: !present }, () => {
  const { result, measurementUnit } = run(fixture(), { rejectPoints: true });
  assert.equal(result.pages[0].boundsPt, null); assert.equal(result.pages[0].bleedPt, null);
  assert.equal(measurementUnit, 'original-units'); assert.ok(hasMessage(result, /단위/));
});

test('caps large scans and states the uninspected remainder', { skip: !present }, () => {
  const doc = fixture(); const p = doc.pages[0];
  doc.allPageItems = { length: 100000, item(index) { return frame('Rectangle', p, { id: index, name: 'Item ' + index }); } };
  const { result } = run(doc);
  assert.ok(result.items.length > 0); assert.ok(result.items.length < 100000);
  assert.ok(hasMessage(result, /제한|일부|중단/)); assert.ok(hasCoverage(result, /제한|일부|중단/));
});

test('keeps page labels unique when section page numbering repeats', { skip: !present }, () => {
  const p1 = page('1'); const p2 = page('1', enums.PageSideOptions.RIGHT_HAND, [0, 600, 800, 1200]); p2.id = 9;
  const doc = fixture([p1, p2]); doc.allPageItems = [frame('TextFrame', p2, { geometricBounds: [40, 640, 760, 1160] })];
  const { result } = run(doc);
  assert.notEqual(result.pages[0].label, result.pages[1].label);
  assert.equal(result.items[0].pageLabel, result.pages[1].label);
});

test('spot tint swatches identify the base ink without inventing a separate spot plate', { skip: !present }, () => {
  const doc = fixture(); const spot = color('CMYK', [40, 10, 0, 0], 'Brand', enums.ColorModel.SPOT);
  const tint = dom('Tint', { name: 'Brand 50', model: enums.ColorModel.SPOT, baseColor: spot, tintValue: 50 });
  doc.swatches = [spot, tint];
  const { result } = run(doc);
  assert.deepEqual(result.spots, [{ name: 'Brand', used: null }]);
});

test('records a shape spot fill with its object label as actual usage requiring intent confirmation', { skip: !present }, () => {
  const p = page(); const doc = fixture([p]);
  doc.allPageItems = [frame('Rectangle', p, { name: 'Brand block', fillColor: color('CMYK', [40, 10, 0, 0], 'Brand', enums.ColorModel.SPOT) })];
  const { result } = run(doc);
  assert.ok(result.extra.some(x => x.severity === '확인 필요' && /Brand block/.test(x.message) && /Brand/.test(x.message) && /별색/.test(x.message)));
});

test('marks image coverage complete only when every exposed image path was inspected', { skip: !present }, () => {
  const doc = fixture();
  doc.allGraphics = [dom('Image', { name: 'CMYK photo', effectivePpi: [300, 300], space: 'CMYK' })];
  const { result } = run(doc);
  assert.equal(result.imageCoverageComplete, true);
});

test('marks image coverage incomplete when a graphics collection cannot be read', { skip: !present }, () => {
  const doc = fixture(); Object.defineProperty(doc, 'allGraphics', { get() { throw new Error('unavailable graphics'); } });
  assert.equal(run(doc).result.imageCoverageComplete, false);
});

test('marks image coverage incomplete when graphics enumeration skips an unreadable object', { skip: !present }, () => {
  const doc = fixture();
  doc.allGraphics = { length: 2, item(index) {
    if (index === 1) throw new Error('unreadable graphic');
    return dom('Image', { name: 'CMYK photo', effectivePpi: [300, 300], space: 'CMYK' });
  } };
  const { result } = run(doc);
  assert.equal(result.images.length, 1); assert.equal(result.imageCoverageComplete, false);
});

test('marks image coverage incomplete after scan truncation even if collected images are CMYK 300PPI', { skip: !present }, () => {
  const doc = fixture();
  doc.allGraphics = { length: 100000, item(index) { return dom('Image', { name: 'Photo ' + index, effectivePpi: [300, 300], space: 'CMYK' }); } };
  const { result } = run(doc);
  assert.ok(result.images.length > 0 && result.images.length < 100000);
  assert.equal(result.imageCoverageComplete, false);
});

test('marks image coverage incomplete for unknown image metadata, imported PDF and uninspected masters', { skip: !present }, () => {
  const unknown = fixture(); unknown.allGraphics = [dom('Image', { name: 'No PPI', space: 'CMYK' })];
  const pdf = fixture(); pdf.allGraphics = [dom('PDF', { name: 'Artwork' })];
  const master = fixture(); master.masterSpreads = [dom('MasterSpread', { name: 'A-Master' })];
  assert.equal(run(unknown).result.imageCoverageComplete, false);
  assert.equal(run(pdf).result.imageCoverageComplete, false);
  assert.equal(run(master).result.imageCoverageComplete, false);
});

test('preserves complete image coverage when unrelated page geometry fails', { skip: !present }, () => {
  const doc = fixture(); Object.defineProperty(doc.pages[0], 'bounds', { get() { throw new Error('bad bounds'); } });
  doc.allGraphics = [dom('Image', { name: 'CMYK photo', effectivePpi: [300, 300], space: 'CMYK' })];
  const { result } = run(doc);
  assert.equal(result.pages[0].boundsPt, null); assert.equal(result.imageCoverageComplete, true);
});
