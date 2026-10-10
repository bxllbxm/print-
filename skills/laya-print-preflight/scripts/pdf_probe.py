#!/usr/bin/env python3
"""Read-only PDF evidence collector; never a press-ready or PDF/X verdict.

Requires pypdf. Exit 1: usable evidence with required manual review. Exit 2:
input/argument/output error. --trim-mm compares only a declared TrimBox's
dimensions (unrotated page coordinates); it never invents a trim position.
--bleed-mm checks declared box margins, never whether artwork fills them.
The JSON report is emitted to stdout and optionally to --json PATH.
"""

import argparse
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path
import sys

try:
    import pypdf
    from pypdf import PdfReader
    from pypdf.generic import ContentStream
except ImportError:
    pypdf = None

IDENTITY = (1., 0., 0., 1., 0., 0.)
MM_PER_POINT = 25.4 / 72
MANUAL_CHECKS = [
    'Confirm final trim, bleed and printer requirements with the user/printer.',
    'Inspect a rendered proof for artwork reaching bleed and safe text/logo margins.',
    'Verify appearance, font substitution/outlines, missing linked assets and placement.',
    'Review final color conversion, spot inks, output intent, overprint and transparency in a print preflight tool.',
    'Review borders, thin strokes, folds, finishing and page orientation against the actual production specification.',
    'Image pixel dimensions do not establish sharpness or exclude prior upsampling.',
    'This collector does not validate PDF/X compliance or print readiness.',
]


class ProbeError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def obj(value):
    return value.get_object() if hasattr(value, 'get_object') else value


def rounded(value):
    return round(value, 4)


def finite(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Non-finite PDF number')
    return result


def concat(current, local):
    a, b, c, d, e, f = current
    g, h, i, j, k, l = local
    return (a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f)


def page_snapshots(reader):
    """Capture inherited box origins before pypdf flattens the page tree."""
    snapshots = []

    def visit(node_ref, inherited, active, depth=0):
        node = obj(node_ref)
        if depth > 64 or id(node) in active:
            raise ValueError('Cyclic or excessive page tree')
        active = active | {id(node)}
        next_values = dict(inherited)
        for key in ('MediaBox', 'CropBox'):
            if '/' + key in node:
                next_values[key] = (obj(node['/' + key]), 'direct')
            elif key in next_values:
                next_values[key] = (next_values[key][0], 'inherited')
        if str(node.get('/Type')) == '/Page':
            for key in ('TrimBox', 'BleedBox'):
                if '/' + key in node:
                    next_values[key] = (obj(node['/' + key]), 'direct')
            snapshots.append(next_values)
        else:
            for child in obj(node.get('/Kids', [])):
                visit(child, next_values, active, depth + 1)

    visit(reader.trailer['/Root']['/Pages'], {}, set())
    return snapshots


def boxes_report(snapshot, user_unit):
    result = {}
    for key, fallback in [('MediaBox', None), ('CropBox', 'MediaBox'),
                          ('TrimBox', 'CropBox'), ('BleedBox', 'CropBox')]:
        explicit = key in snapshot
        if explicit:
            raw, source = snapshot[key]
            values = [finite(x) for x in raw]
        elif fallback:
            values = result[fallback]['points'][:]
            source = 'fallback:' + fallback
        else:
            raise ValueError('Missing required MediaBox')
        if len(values) != 4 or values[2] <= values[0] or values[3] <= values[1]:
            raise ValueError('Invalid ' + key)
        scale = MM_PER_POINT * user_unit
        result[key] = dict(explicit=explicit, source=source, points=values,
                           mm=[rounded(x*scale) for x in values],
                           width_mm=rounded((values[2]-values[0])*scale),
                           height_mm=rounded((values[3]-values[1])*scale))
    return result


def contains(outer, inner):
    return (outer[0] <= inner[0] and outer[1] <= inner[1]
            and outer[2] >= inner[2] and outer[3] >= inner[3])


def geometry_report(boxes, unit, trim_mm, bleed_mm):
    trim, bleed = boxes['TrimBox'], boxes['BleedBox']
    geometry = {'artwork_bleed_verified': False,
                'trim_dimensions': {'status': 'unknown' if not trim['explicit'] else 'not_requested'},
                'bleed_margins': {'status': 'not_requested'}}
    if trim_mm:
        check = geometry['trim_dimensions']
        check['requested_mm'] = list(trim_mm)
        if trim['explicit']:
            matches = all(abs(found-wanted) <= .1 for found, wanted in
                          zip((trim['width_mm'], trim['height_mm']), trim_mm))
            check['status'] = 'matches' if matches else 'mismatch'
            check['tolerance_mm'] = .1
    if bleed_mm is not None:
        check = geometry['bleed_margins']
        check['requested_mm'] = bleed_mm
        check['status'] = 'unknown'
        if trim['explicit'] and bleed['explicit']:
            t, b = trim['points'], bleed['points']
            scale = unit * MM_PER_POINT
            margins = dict(zip(('left', 'bottom', 'right', 'top'),
                               [(t[0]-b[0])*scale, (t[1]-b[1])*scale,
                                (b[2]-t[2])*scale, (b[3]-t[3])*scale]))
            check['margins_mm'] = {k: rounded(v) for k, v in margins.items()}
            valid = contains(boxes['MediaBox']['points'], b) and contains(b, t)
            check['status'] = ('meets_geometry' if valid and all(v+1e-6 >= bleed_mm for v in margins.values())
                               else 'insufficient_geometry')
    geometry['declared_boxes_within_media'] = all(contains(boxes['MediaBox']['points'], boxes[k]['points'])
                                                for k in ('CropBox', 'TrimBox', 'BleedBox'))
    return geometry


class PageEvidence:
    def __init__(self, reader, unit, min_ppi):
        self.reader, self.unit, self.min_ppi = reader, unit, min_ppi
        self.fonts, self.images, self.color_evidence, self.reasons = [], [], [], set()
        self.spots, self.seen_resources = set(), set()

    def color_space(self, value, resources=None, active=None):
        value = obj(value)
        active = set() if active is None else active
        if id(value) in active:
            self.reasons.add('Cyclic color space requires manual review.')
            return {'name': 'unknown', 'channels': None}
        active = active | {id(value)}
        aliases = {'/RGB': '/DeviceRGB', '/CMYK': '/DeviceCMYK', '/G': '/DeviceGray'}
        if isinstance(value, str):
            value = aliases.get(str(value), str(value))
            channels = {'/DeviceRGB': 3, '/DeviceCMYK': 4, '/DeviceGray': 1}.get(value)
            if channels:
                return {'name': value[1:], 'channels': channels}
            spaces = obj((resources or {}).get('/ColorSpace', {}))
            if value in spaces:
                return self.color_space(spaces[value], resources, active)
            self.reasons.add('Unresolved color space ' + value + ' requires manual review.')
            return {'name': value.lstrip('/'), 'channels': None}
        if isinstance(value, (list, tuple)) and value:
            kind = str(value[0])
            if kind == '/ICCBased':
                profile = obj(value[1])
                channels = int(profile.get('/N', 0)) or None
                header = profile.get_data()[:128] if hasattr(profile, 'get_data') else b''
                model = header[16:20].decode('ascii', errors='replace').strip() if len(header) >= 20 else None
                self.reasons.add('ICC profile suitability and conversion require manual review.')
                return {'name': 'ICCBased', 'channels': channels, 'profile_color_space': model,
                        'profile_validated': False}
            if kind in ('/Separation', '/DeviceN', '/NChannel'):
                names = [str(value[1]).lstrip('/')] if kind == '/Separation' else [str(v).lstrip('/') for v in obj(value[1])]
                self.spots.update(n for n in names if n not in ('None', 'All'))
                self.reasons.add('Spot color/tint transforms require manual review.')
                return {'name': kind[1:], 'channels': len(names), 'spot_names': names}
            if kind == '/Indexed':
                base = self.color_space(value[1], resources, active)
                return {'name': 'Indexed', 'channels': 1, 'base': base}
            if kind in ('/CalRGB', '/CalGray', '/Lab'):
                self.reasons.add('Calibrated/Lab color conversion requires manual review.')
                return {'name': kind[1:], 'channels': 1 if kind == '/CalGray' else 3}
            if kind == '/Pattern':
                self.reasons.add('Pattern color spaces and paint require manual review.')
                return {'name': 'Pattern', 'channels': None}
        self.reasons.add('Unsupported color space requires manual review.')
        return {'name': 'unknown', 'channels': None}

    def note_color(self, value, resources, location, kind):
        color = self.color_space(value, resources)
        self.color_evidence.append({'location': location, 'kind': kind, 'color_space': color})
        return color

    def embedding(self, font):
        font = obj(font)
        if str(font.get('/Subtype')) == '/Type3':
            self.reasons.add('Type3 glyph appearance streams are not inspected for image/color paint; manual review is required.')
            programs = obj(font.get('/CharProcs', {}))
            present = bool(programs) and all(hasattr(obj(p), 'get_data') and bool(obj(p).get_data()) for p in programs.values())
            return ('type3_program_present' if present else 'missing_program'), []
        if str(font.get('/Subtype')) == '/Type0':
            descendants = [self.embedding(f)[0] for f in obj(font.get('/DescendantFonts', []))]
            return ('embedded_program_present' if descendants and all(s == 'embedded_program_present' for s in descendants)
                    else 'missing_program'), descendants
        descriptor = obj(font.get('/FontDescriptor', {}))
        programs = [obj(descriptor[k]) for k in ('/FontFile', '/FontFile2', '/FontFile3') if k in descriptor]
        present = any(hasattr(p, 'get_data') and bool(p.get_data()) for p in programs)
        return ('embedded_program_present' if present else 'missing_program'), []

    def scan_resources(self, resources, location, depth=0):
        resources = obj(resources or {})
        if id(resources) in self.seen_resources:
            return
        self.seen_resources.add(id(resources))
        if depth > 32:
            self.reasons.add('Resource depth limit; some resource evidence is unknown.')
            return
        for key, font_ref in obj(resources.get('/Font', {})).items():
            font = obj(font_ref)
            status, descendants = self.embedding(font)
            self.fonts.append({'location': location + '/' + str(key).lstrip('/'),
                               'base_font': str(font.get('/BaseFont', 'unknown')).lstrip('/'),
                               'subtype': str(font.get('/Subtype', 'unknown')).lstrip('/'),
                               'embedding_status': status, 'descendant_statuses': descendants,
                               'font_program_validated': False})
        for key, space in obj(resources.get('/ColorSpace', {})).items():
            self.note_color(space, resources, location + '/' + str(key).lstrip('/'), 'resource')
            if str(key).startswith('/Default'):
                self.reasons.add('Default color space overrides require manual review.')
        for key, xref in obj(resources.get('/XObject', {})).items():
            xobject = obj(xref)
            loc = location + '/' + str(key).lstrip('/')
            if str(xobject.get('/Subtype')) == '/Form':
                self.scan_resources(obj(xobject.get('/Resources', resources)), loc, depth+1)
            elif str(xobject.get('/Subtype')) == '/Image' and '/ColorSpace' in xobject:
                self.note_color(xobject['/ColorSpace'], resources, loc, 'image_resource')
        if '/Pattern' in resources:
            self.reasons.add('Pattern resources require manual review.')
        if '/Shading' in resources:
            self.reasons.add('Shading resources require manual review.')
        if '/ExtGState' in resources:
            self.reasons.add('Graphics state resources (including overprint/transparency) require manual review.')

    def placed_image(self, image, ctm, resources, location, kind):
        width = int(image.get('/Width', image.get('/W', 0)))
        height = int(image.get('/Height', image.get('/H', 0)))
        a, b, c, d, _, _ = ctm
        x_inches, y_inches = math.hypot(a, b)*self.unit/72, math.hypot(c, d)*self.unit/72
        valid = width > 0 and height > 0 and x_inches > 0 and y_inches > 0 and abs(a*d-b*c) > 1e-12
        color = self.note_color(image.get('/ColorSpace', image.get('/CS', 'unknown')), resources, location, kind)
        skew = abs(a*c+b*d) > 1e-6 * max(1., math.hypot(a,b)*math.hypot(c,d))
        if skew:
            self.reasons.add('Sheared image: PPI is along transformed image axes; directional resolution needs review.')
        if not valid:
            self.reasons.add('Invalid dimensions or degenerate image transform; PPI is unknown.')
        if image.get('/ImageMask', image.get('/IM', False)) or '/SMask' in image or '/Mask' in image:
            self.reasons.add('Image masks/transparency require manual review.')
        px = width/x_inches if valid else None
        py = height/y_inches if valid else None
        self.images.append({'location': location, 'kind': kind, 'pixel_width': width, 'pixel_height': height,
                            'ctm': [rounded(x) for x in ctm], 'color_space': color,
                            'ppi_x': rounded(px) if px is not None else None,
                            'ppi_y': rounded(py) if py is not None else None,
                            'ppi_status': 'axis_estimate' if valid else 'unknown', 'sheared': skew,
                            'below_min_ppi': min(px, py) < self.min_ppi if valid else None})

    def walk(self, content, resources, ctm=IDENTITY, location='page', active=None, depth=0):
        active = set() if active is None else active
        resources = obj(resources or {})
        if depth > 32:
            self.reasons.add('Content depth limit; some placed images/colors are unknown.')
            return
        if content is None:
            return
        stack = []
        operators = ContentStream(content, self.reader).operations
        for index, (operands, operation) in enumerate(operators):
            loc = location + ':' + str(index+1)
            if operation == b'q':
                stack.append(ctm)
            elif operation == b'Q':
                if stack:
                    ctm = stack.pop()
                else:
                    self.reasons.add('Unbalanced graphics-state restore; placement may be unknown.')
            elif operation == b'cm':
                if len(operands) != 6:
                    raise ValueError('Invalid transform matrix')
                ctm = concat(ctm, tuple(finite(v) for v in operands))
            elif operation in (b'rg', b'RG', b'k', b'K', b'g', b'G'):
                color = {b'rg': '/DeviceRGB', b'RG': '/DeviceRGB', b'k': '/DeviceCMYK',
                         b'K': '/DeviceCMYK', b'g': '/DeviceGray', b'G': '/DeviceGray'}[operation]
                self.note_color(color, resources, loc, 'color_operator:' + operation.decode())
            elif operation in (b'cs', b'CS'):
                self.note_color(operands[0], resources, loc, 'color_operator:' + operation.decode())
            elif operation in (b'scn', b'SCN'):
                self.reasons.add('Complex scn/SCN color paint requires manual review.')
            elif operation == b'sh':
                self.reasons.add('Shading paint requires manual review.')
            elif operation == b'gs':
                self.reasons.add('Graphics state paint (overprint/transparency) requires manual review.')
            elif operation == b'INLINE IMAGE':
                self.placed_image(operands['settings'], ctm, resources, loc, 'inline')
            elif operation == b'Do':
                objects = obj(resources.get('/XObject', {}))
                key = operands[0]
                if key not in objects:
                    self.reasons.add('Unresolved XObject ' + str(key) + '; image/color evidence may be incomplete.')
                    continue
                xobject = obj(objects[key])
                subtype = str(xobject.get('/Subtype'))
                if subtype == '/Image':
                    self.placed_image(xobject, ctm, resources, loc + '/' + str(key).lstrip('/'), 'xobject')
                elif subtype == '/Form':
                    if id(xobject) in active:
                        self.reasons.add('Cyclic Form XObject; placement evidence is incomplete.')
                        continue
                    matrix = tuple(finite(v) for v in obj(xobject.get('/Matrix', IDENTITY)))
                    if len(matrix) != 6:
                        raise ValueError('Invalid Form matrix')
                    child_resources = obj(xobject.get('/Resources', resources))
                    self.walk(xobject, child_resources, concat(ctm, matrix),
                              loc + '/' + str(key).lstrip('/'), active | {id(xobject)}, depth+1)
                else:
                    self.reasons.add('Unsupported XObject subtype requires manual review.')
        if stack:
            self.reasons.add('Unbalanced graphics-state save; placement may be unknown.')

    def colors(self):
        def rgb(space):
            return (space['name'] in ('DeviceRGB', 'CalRGB')
                    or (space['name'] == 'ICCBased' and space.get('profile_color_space') == 'RGB')
                    or ('base' in space and rgb(space['base'])))
        return {'status': 'manual_review', 'rgb_evidence': any(rgb(e['color_space']) for e in self.color_evidence),
                'all_cmyk_verified': False, 'spot_names': sorted(self.spots),
                'evidence': self.color_evidence, 'review_reasons': sorted(self.reasons),
                'inventory_can_include_unused_resources': True}


def collect(path, trim_mm, bleed_mm, min_ppi):
    if pypdf is None:
        raise ProbeError('dependency_unavailable', 'pypdf is required. Use a Python environment with pypdf installed (for example the Codex bundled Python runtime).')
    data = path.read_bytes()
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ProbeError('encrypted_pdf', 'Encrypted PDF cannot be inspected by this collector; provide an authorized unencrypted copy.')
    snapshots = page_snapshots(reader)
    report = {'schema_version': 1, 'status': 'manual_review', 'complete': False,
              'tool': {'name': 'pdf_probe', 'version': '1.0', 'parser': 'pypdf', 'parser_version': pypdf.__version__},
              'source': {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(),
                         'bytes': len(data), 'page_count': len(reader.pages)},
              'requested': {'trim_mm': trim_mm, 'bleed_mm': bleed_mm, 'min_ppi': min_ppi},
              'pages': [], 'findings': [], 'manual_checks': MANUAL_CHECKS}
    if len(reader.pages) != len(snapshots):
        raise ValueError('Page tree mismatch')
    if not snapshots:
        raise ValueError('PDF has no pages')
    for number, (page, snapshot) in enumerate(zip(reader.pages, snapshots), 1):
        unit = finite(page.get('/UserUnit', 1))
        if not 0 < unit <= 75000:
            raise ValueError('Invalid UserUnit')
        boxes = boxes_report(snapshot, unit)
        geometry = geometry_report(boxes, unit, trim_mm, bleed_mm)
        evidence = PageEvidence(reader, unit, min_ppi)
        if page.get('/Annots'):
            evidence.reasons.add('Page annotations and their appearance streams are not inspected for image/color paint; manual review is required.')
        resources = obj(page.get('/Resources', {}))
        evidence.scan_resources(resources, 'page' + str(number))
        evidence.walk(page.get('/Contents'), resources, location='page' + str(number))
        colors = evidence.colors()
        report['pages'].append({'page': number, 'user_unit': unit, 'rotation_degrees': int(page.get('/Rotate', 0)),
                                'boxes': boxes, 'geometry': geometry, 'fonts': evidence.fonts,
                                'outlines_verified': False, 'colors': colors, 'images': evidence.images})
        findings = []
        if not boxes['TrimBox']['explicit']:
            findings.append(('unknown', 'missing_explicit_trim', 'TrimBox is absent; its fallback is not confirmed trim.'))
        if geometry['trim_dimensions']['status'] == 'mismatch':
            findings.append(('finding', 'trim_dimensions_mismatch', 'Declared TrimBox dimensions differ from the requested dimensions.'))
        if geometry['bleed_margins']['status'] == 'unknown':
            findings.append(('unknown', 'bleed_geometry_unknown', 'Explicit TrimBox and BleedBox are needed for the requested margin comparison.'))
        if geometry['bleed_margins']['status'] == 'insufficient_geometry':
            findings.append(('finding', 'bleed_geometry_insufficient', 'Declared boxes do not support the requested bleed margin within MediaBox.'))
        if not geometry['declared_boxes_within_media']:
            findings.append(('finding', 'boxes_outside_media', 'A declared page box exceeds MediaBox.'))
        if colors['rgb_evidence']:
            findings.append(('finding', 'rgb_evidence', 'RGB color operators or resources were found; evaluate conversion/usage.'))
        if colors['spot_names']:
            findings.append(('finding', 'spot_color_evidence', 'Named spot color resources were found; confirm intended inks.'))
        if any(f['embedding_status'] == 'missing_program' for f in evidence.fonts):
            findings.append(('finding', 'font_program_missing', 'A font resource has no detected embedded program.'))
        if any(i['below_min_ppi'] for i in evidence.images):
            findings.append(('finding', 'image_below_min_ppi', 'A placed image axis estimate is below the requested PPI threshold.'))
        if evidence.reasons:
            findings.append(('unknown', 'manual_color_or_placement_review', 'Complex/unsupported operations or resources need manual review; see colors.review_reasons.'))
        report['findings'].extend({'page': number, 'level': level, 'code': code, 'message': message}
                                  for level, code, message in findings)
    return report


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError('must be a positive finite number')
    return number


def nonnegative(value):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError('must be a nonnegative finite number')
    return number


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ProbeError('invalid_arguments', message)


def main():
    output = None
    logging.getLogger('pypdf').setLevel(logging.CRITICAL)
    try:
        parser = Parser(description=__doc__)
        parser.add_argument('pdf', type=Path)
        parser.add_argument('--trim-mm', nargs=2, type=positive, metavar=('WIDTH', 'HEIGHT'))
        parser.add_argument('--bleed-mm', type=nonnegative)
        parser.add_argument('--min-ppi', type=positive, default=300.)
        parser.add_argument('--json', type=Path)
        args = parser.parse_args()
        source = args.pdf.expanduser().resolve()
        output = args.json.expanduser().resolve() if args.json else None
        if output and (output == source or (output.exists() and source.exists() and os.path.samefile(output, source))):
            raise ProbeError('output_is_input', 'Report path must not overwrite the PDF input.')
        report = collect(source, args.trim_mm, args.bleed_mm, args.min_ppi)
        rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        if output:
            output.write_text(rendered, encoding='utf-8')
        sys.stdout.write(rendered)
        return 1
    except Exception as exc:
        code = exc.code if isinstance(exc, ProbeError) else ('io_error' if isinstance(exc, OSError) else 'malformed_pdf')
        error = {'schema_version': 1, 'status': 'error', 'complete': False,
                 'error': {'code': code, 'message': str(exc)}}
        sys.stdout.write(json.dumps(error, ensure_ascii=False, indent=2) + '\n')
        return 2


if __name__ == '__main__':
    sys.exit(main())
