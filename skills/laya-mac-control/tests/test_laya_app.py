import importlib.util
import pathlib
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "laya_app.py"
spec = importlib.util.spec_from_file_location("laya_app", SCRIPT)
laya_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_app)


class LayaAppTests(unittest.TestCase):
    def test_requested_apps_resolve(self):
        for prompt, expected in (
            ("포토부스 켜줘", "Photo Booth"),
            ("포토부스켜주세요", "Photo Booth"),
            ("메모 킨다", "Notes"),
            ("메모를 열어줘", "Notes"),
            ("크롬 실행해", "Google Chrome"),
            ("Open Photo Booth", "Photo Booth"),
        ):
            with self.subTest(prompt=prompt):
                self.assertEqual(laya_app.resolve_app(prompt), expected)

    def test_ambiguous_or_other_actions_do_not_launch(self):
        for prompt in ("메모에 글 적어줘", "크롬 종료해", "크롬과 메모 열어줘", "앱 켜줘", "메모리 켜줘"):
            with self.subTest(prompt=prompt):
                with self.assertRaises(ValueError):
                    laya_app.resolve_app(prompt)

    @patch.object(laya_app.platform, "system", return_value="Darwin")
    @patch.object(laya_app.subprocess, "run")
    def test_launch_uses_argument_list_and_checks_result(self, run, _system):
        run.return_value.returncode = 0
        result = laya_app.launch_app("Google Chrome")
        run.assert_called_once_with(["open", "-a", "Google Chrome"], capture_output=True, text=True, check=False)
        self.assertEqual(result["status"], "launch-requested")

    @patch.object(laya_app.subprocess, "run")
    def test_dry_run_has_no_side_effect(self, run):
        self.assertEqual(laya_app.launch_app("Notes", dry_run=True)["status"], "dry-run")
        run.assert_not_called()

    @patch.object(laya_app.platform, "system", return_value="Darwin")
    @patch.object(laya_app.subprocess, "run")
    def test_missing_app_is_reported(self, run, _system):
        run.return_value.returncode = 1
        run.return_value.stderr = "Unable to find application"
        with self.assertRaisesRegex(RuntimeError, "Unable to find application"):
            laya_app.launch_app("Missing App")


if __name__ == "__main__":
    unittest.main()
