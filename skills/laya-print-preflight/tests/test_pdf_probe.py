import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject,
                          FloatObject, NameObject, NumberObject, TextStringObject)

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'pdf_probe.py'


def arr(*values):
    return ArrayObject([FloatObject(x) for x in values])


def stream(writer, data, **entries):
    value = DecodedStreamObject()
    value.set_data(data)
    for key, item in entries.items():
        value[NameObject('/' + key)] = item
    return writer._add_object(value)


def name(value):
    return NameObject('/' + value)


def resources(**entries):
    return DictionaryObject({name(k): v for k, v in entries.items()})


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'input.pdf'
        self.writer = PdfWriter()
        self.page = self.writer.add_blank_page(width=612, height=792)

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.writer.write(self.path)

    def run_probe(self, *args, expected_code=1):
        self.assertTrue(SCRIPT.exists(), 'PDF evidence collector is not implemented')
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.path), *args],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, expected_code, result.stderr + result.stdout)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_missing_explicit_trim_is_unknown_and_never_complete(self):
        self.save()
        before = self.path.read_bytes()
        report = self.run_probe('--trim-mm', '215.9', '279.4')
        self.assertFalse(report['complete'])
        self.assertEqual(report['source']['sha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(report['source']['page_count'], 1)
        box = report['pages'][0]['boxes']['TrimBox']
        self.assertFalse(box['explicit'])
        self.assertEqual(box['source'], 'fallback:CropBox')
        self.assertEqual(report['pages'][0]['geometry']['trim_dimensions']['status'], 'unknown')
        self.assertEqual(self.path.read_bytes(), before)

    def test_explicit_boxes_compare_user_dimensions_and_all_bleed_sides(self):
        self.page[name('TrimBox')] = arr(18, 18, 594, 774)
        self.page[name('BleedBox')] = arr(9, 9, 603, 783)
        self.page[name('UserUnit')] = FloatObject(2)
        self.save()
        report = self.run_probe('--trim-mm', '406.4', '533.4', '--bleed-mm', '6')
        page = report['pages'][0]
        self.assertEqual(page['user_unit'], 2)
        self.assertEqual(page['geometry']['trim_dimensions']['status'], 'matches')
        self.assertEqual(page['geometry']['bleed_margins']['status'], 'meets_geometry')
        self.assertEqual(page['boxes']['TrimBox']['width_mm'], 406.4)
        self.assertAlmostEqual(page['geometry']['bleed_margins']['margins_mm']['left'], 6.35)
        too_large = self.run_probe('--bleed-mm', '7')
        self.assertEqual(too_large['pages'][0]['geometry']['bleed_margins']['status'], 'insufficient_geometry')

    def test_inherited_media_and_crop_sources_survive_reader_flattening(self):
        parent = self.page['/Parent'].get_object()
        parent[name('MediaBox')] = self.page.pop(name('MediaBox'))
        parent[name('CropBox')] = arr(10, 10, 602, 782)
        parent[name('TrimBox')] = arr(20, 20, 592, 772)
        self.save()
        boxes = self.run_probe()['pages'][0]['boxes']
        self.assertEqual(boxes['MediaBox']['source'], 'inherited')
        self.assertEqual(boxes['CropBox']['source'], 'inherited')
        self.assertFalse(boxes['TrimBox']['explicit'])
        self.assertEqual(boxes['TrimBox']['points'], [10.0, 10.0, 602.0, 782.0])

    def test_nested_form_reports_rgb_and_spot_resources(self):
        spot = ArrayObject([name('Separation'), name('PANTONE#20123#20C'), name('DeviceCMYK'),
                            DictionaryObject({name('FunctionType'): NumberObject(2),
                                              name('Domain'): arr(0, 1), name('C0'): arr(0, 0, 0, 0),
                                              name('C1'): arr(0, .2, 1, 0), name('N'): NumberObject(1)})])
        form_res = resources(ColorSpace=resources(Spot=spot))
        inner = stream(self.writer, b'1 0 0 rg 0 0 10 10 re f /Spot cs 1 scn 0 0 5 5 re f',
                       Type=name('XObject'), Subtype=name('Form'), BBox=arr(0, 0, 10, 10), Resources=form_res)
        outer = stream(self.writer, b'/Inner Do', Type=name('XObject'), Subtype=name('Form'),
                       BBox=arr(0, 0, 10, 10), Resources=resources(XObject=resources(Inner=inner)))
        self.page[name('Resources')] = resources(XObject=resources(Outer=outer))
        self.page[name('Contents')] = stream(self.writer, b'/Outer Do')
        self.save()
        color = self.run_probe()['pages'][0]['colors']
        self.assertTrue(color['rgb_evidence'])
        self.assertEqual(color['spot_names'], ['PANTONE#20123#20C'])
        self.assertFalse(color['all_cmyk_verified'])

    def test_empty_color_inventory_is_not_proof_of_cmyk(self):
        self.save()
        colors = self.run_probe()['pages'][0]['colors']
        self.assertFalse(colors['rgb_evidence'])
        self.assertFalse(colors['all_cmyk_verified'])
        self.assertEqual(colors['status'], 'manual_review')

    def test_pattern_and_shading_require_manual_review(self):
        self.page[name('Resources')] = resources(ColorSpace=resources(P=ArrayObject([name('Pattern'), name('DeviceCMYK')])))
        self.page[name('Contents')] = stream(self.writer, b'/P cs /Whatever scn /Sh sh')
        self.save()
        reasons = self.run_probe()['pages'][0]['colors']['review_reasons']
        self.assertTrue(any('Pattern' in reason for reason in reasons))
        self.assertTrue(any('shading' in reason.lower() for reason in reasons))

    def test_each_image_placement_has_effective_ppi_with_form_matrix_and_user_unit(self):
        image = stream(self.writer, bytes([0, 0, 0]) * 10000, Type=name('XObject'), Subtype=name('Image'),
                       Width=NumberObject(100), Height=NumberObject(100), BitsPerComponent=NumberObject(8), ColorSpace=name('DeviceRGB'))
        inner = stream(self.writer, b'q 72 0 0 72 0 0 cm /Im Do Q', Type=name('XObject'), Subtype=name('Form'),
                       BBox=arr(0, 0, 72, 72), Matrix=arr(2, 0, 0, 2, 0, 0), Resources=resources(XObject=resources(Im=image)))
        self.page[name('Resources')] = resources(XObject=resources(F=inner))
        self.page[name('Contents')] = stream(self.writer, b'q /F Do Q q .5 0 0 .5 0 0 cm /F Do Q')
        self.page[name('UserUnit')] = FloatObject(2)
        self.save()
        images = self.run_probe()['pages'][0]['images']
        self.assertEqual(len(images), 2)
        self.assertEqual([item['ppi_x'] for item in images], [25.0, 50.0])
        self.assertEqual([item['ppi_y'] for item in images], [25.0, 50.0])
        self.assertTrue(all(item['below_min_ppi'] for item in images))
        self.assertEqual(images[0]['color_space']['channels'], 3)

    def test_inline_image_uses_placement_scale(self):
        self.page[name('Contents')] = stream(self.writer, b'q 72 0 0 72 0 0 cm BI /W 2 /H 2 /BPC 8 /CS /RGB ID ' + bytes([0, 0, 0]) * 4 + b' EI Q')
        self.save()
        image = self.run_probe()['pages'][0]['images'][0]
        self.assertEqual(image['kind'], 'inline')
        self.assertEqual(image['ppi_x'], 2.0)
        self.assertEqual(image['color_space']['channels'], 3)

    def test_icc_three_channels_do_not_prove_rgb_without_profile_header(self):
        profile = stream(self.writer, b'\0' * 16 + b'Lab ' + b'\0' * 108, N=NumberObject(3))
        self.page[name('Resources')] = resources(ColorSpace=resources(ICC=ArrayObject([name('ICCBased'), profile])))
        self.save()
        color = self.run_probe()['pages'][0]['colors']
        self.assertFalse(color['rgb_evidence'])
        self.assertEqual(color['evidence'][0]['color_space']['profile_color_space'], 'Lab')

    def test_degenerate_image_transform_has_unknown_ppi(self):
        image = stream(self.writer, bytes([0]) * 4, Type=name('XObject'), Subtype=name('Image'),
                       Width=NumberObject(2), Height=NumberObject(2), ColorSpace=name('DeviceGray'))
        self.page[name('Resources')] = resources(XObject=resources(Im=image))
        self.page[name('Contents')] = stream(self.writer, b'72 0 72 0 0 0 cm /Im Do')
        self.save()
        placement = self.run_probe()['pages'][0]['images'][0]
        self.assertEqual(placement['ppi_status'], 'unknown')
        self.assertIsNone(placement['ppi_x'])

    def test_hard_link_report_path_cannot_overwrite_input(self):
        self.save()
        import os
        alias = self.path.parent / 'alias.pdf'
        os.link(self.path, alias)
        before = self.path.read_bytes()
        self.assertEqual(self.run_probe('--json', str(alias), expected_code=2)['error']['code'], 'output_is_input')
        self.assertEqual(self.path.read_bytes(), before)

    def test_missing_dependency_has_actionable_structured_error(self):
        self.save()
        result = subprocess.run([sys.executable, '-S', str(SCRIPT), str(self.path)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, '')
        report = json.loads(result.stdout)
        self.assertEqual(report['error']['code'], 'dependency_unavailable')
        self.assertIn('pypdf', report['error']['message'])

    def test_tool_metadata_reports_parser_version(self):
        self.save()
        report = self.run_probe()
        self.assertIn('tool', report)
        self.assertEqual(report['tool']['parser'], 'pypdf')
        self.assertRegex(report['tool']['parser_version'], r'^\d+\.')

    def test_type0_descendants_and_type3_program_are_distinguished(self):
        font_file = stream(self.writer, b'not-a-validated-font')
        descriptor = resources(Type=name('FontDescriptor'), FontName=name('TestFont'), FontFile2=font_file)
        embedded = resources(Type=name('Font'), Subtype=name('CIDFontType2'), BaseFont=name('Embedded'), FontDescriptor=descriptor)
        missing = resources(Type=name('Font'), Subtype=name('CIDFontType2'), BaseFont=name('Missing'))
        type0_ok = resources(Type=name('Font'), Subtype=name('Type0'), BaseFont=name('OK'), DescendantFonts=ArrayObject([embedded]))
        type0_bad = resources(Type=name('Font'), Subtype=name('Type0'), BaseFont=name('BAD'), DescendantFonts=ArrayObject([missing]))
        type3 = resources(Type=name('Font'), Subtype=name('Type3'), CharProcs=resources(A=stream(self.writer, b'0 0 d0')))
        self.page[name('Resources')] = resources(Font=resources(OK=type0_ok, BAD=type0_bad, T3=type3))
        self.save()
        fonts = self.run_probe()['pages'][0]['fonts']
        self.assertEqual([item['embedding_status'] for item in fonts], ['embedded_program_present', 'missing_program', 'type3_program_present'])
        self.assertFalse(self.run_probe()['pages'][0]['outlines_verified'])

    def test_no_fonts_does_not_prove_text_is_outlined(self):
        self.save()
        page = self.run_probe()['pages'][0]
        self.assertEqual(page['fonts'], [])
        self.assertFalse(page['outlines_verified'])

    def test_type3_glyph_appearance_is_explicitly_uninspected(self):
        type3 = resources(Type=name('Font'), Subtype=name('Type3'), CharProcs=resources(A=stream(self.writer, b'0 0 d0')))
        self.page[name('Resources')] = resources(Font=resources(T3=type3))
        self.save()
        reasons = self.run_probe()['pages'][0]['colors']['review_reasons']
        self.assertTrue(any('Type3' in reason for reason in reasons))

    def test_annotation_appearances_are_explicitly_uninspected(self):
        appearance = stream(self.writer, b'1 0 0 rg 0 0 10 10 re f', Type=name('XObject'), Subtype=name('Form'), BBox=arr(0, 0, 10, 10))
        self.page[name('Annots')] = ArrayObject([resources(Type=name('Annot'), Subtype=name('Stamp'),
                                                         Rect=arr(0, 0, 10, 10), AP=resources(N=appearance))])
        self.save()
        reasons = self.run_probe()['pages'][0]['colors']['review_reasons']
        self.assertTrue(any('annotation' in reason.lower() for reason in reasons))

    def test_zero_bleed_is_a_valid_confirmed_specification(self):
        self.page[name('TrimBox')] = arr(0, 0, 612, 792)
        self.page[name('BleedBox')] = arr(0, 0, 612, 792)
        self.save()
        geometry = self.run_probe('--bleed-mm', '0')['pages'][0]['geometry']
        self.assertEqual(geometry['bleed_margins']['status'], 'meets_geometry')

    def test_bad_pdf_and_encrypted_pdf_return_structured_errors(self):
        self.path.write_bytes(b'not a pdf')
        self.assertEqual(self.run_probe(expected_code=2)['status'], 'error')
        self.writer.encrypt('secret')
        self.save()
        error = self.run_probe(expected_code=2)
        self.assertEqual(error['error']['code'], 'encrypted_pdf')

    def test_json_file_never_overwrites_input(self):
        self.save()
        before = self.path.read_bytes()
        self.assertEqual(self.run_probe('--json', str(self.path), expected_code=2)['error']['code'], 'output_is_input')
        self.assertEqual(self.path.read_bytes(), before)
        output = self.path.parent / 'evidence.json'
        report = self.run_probe('--json', str(output))
        self.assertEqual(json.loads(output.read_text()), report)


if __name__ == '__main__':
    unittest.main()
