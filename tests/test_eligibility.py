"""tools/eligibility.py: rules-based Remote Eligibility Gate on structured data."""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "eligibility.py"
sys.path.insert(0, str(ROOT / "tools"))
import eligibility  # noqa: E402

TARGETS = {"DE", "AT", "NL", "PL", "IE", "EE", "JP", "US"}


def verdict(job, base="PK", targets=TARGETS):
    return eligibility.location(job, base, targets)[:2]


class Location(unittest.TestCase):
    def test_himalayas_empty_list_is_worldwide(self):
        self.assertEqual(verdict({"worldwide": True, "location_restrictions": []}), ("PASS", None))

    def test_base_country_listed_passes(self):
        self.assertEqual(verdict({"location_restrictions": ["India", "Pakistan"]})[0], "PASS")

    def test_target_country_listed_is_relocation_flag(self):
        v, note = verdict({"location_restrictions": ["Estonia", "Latvia", "Lithuania"]})
        self.assertEqual(v, "FLAG")
        self.assertIn("relocation needed", note)
        self.assertIn("EE", note)

    def test_no_base_and_no_target_fails(self):
        v, note = verdict({"location_restrictions": ["Canada", "Mexico"]})
        self.assertEqual(v, "FAIL")
        self.assertIn("excludes base PK", note)

    def test_unknown_name_is_never_a_fail(self):
        self.assertEqual(verdict({"location_restrictions": ["Atlantis"]})[0], "FLAG")

    def test_wwr_regions(self):
        self.assertEqual(verdict({"region": "Anywhere in the World", "countries": []})[0], "PASS")
        self.assertEqual(verdict({"region": "Asia Only", "countries": []})[0], "PASS")
        self.assertEqual(verdict({"region": "USA Only", "countries": []})[0], "FLAG")  # US is a target
        self.assertEqual(verdict({"region": "Latin America Only", "countries": []})[0], "FAIL")

    def test_ambiguous_region_membership_flags(self):
        v, note = verdict({"region": "EMEA"}, targets=set())
        self.assertEqual(v, "FLAG")
        self.assertIn("unclear", note)

    def test_iso_codes_and_case(self):
        self.assertEqual(verdict({"countries": ["pk"]})[0], "PASS")

    def test_no_structured_field_is_left_to_the_model(self):
        self.assertEqual(eligibility.location({"location": "Remote"}, "PK", TARGETS), (None, None, False))


class EdgeCases(unittest.TestCase):
    """Cases found in live Himalayas / We Work Remotely data (2026-11-18)."""

    def test_every_iso_name_resolves_to_its_own_code(self):
        from country_codes import COUNTRIES
        for code, names in COUNTRIES.items():
            for name in names:
                self.assertEqual(eligibility.resolve(name), ("country", {code}), name)
        self.assertGreaterEqual(len(COUNTRIES), 249)

    def test_iso_style_names_from_himalayas(self):
        for name, code in (("Côte d'Ivoire", "CI"), ("Palestine, State of", "PS"), ("Virgin Islands, U.S.", "VI"),
                           ("Holy See (Vatican City State)", "VA"), ("Congo, The Democratic Republic of the", "CD"),
                           ("Åland Islands", "AX"), ("Kosovo", "XK")):
            self.assertEqual(eligibility.resolve(name), ("country", {code}), name)

    def test_list_of_only_non_target_countries_fails_not_flags(self):
        # Before the full table, "Albania, Belarus..." was "unrecognised" -> FLAG.
        self.assertEqual(verdict({"location_restrictions": ["Albania", "Belarus", "Moldova"]})[0], "FAIL")

    def test_worldwide_label_with_a_country_is_a_conflict_flag(self):
        job = {"region": "Anywhere in the World", "countries": ["United States of America"], "worldwide": True}
        v, note = verdict(job, targets=set())
        self.assertEqual(v, "FLAG")
        self.assertIn("says Anywhere in the World", note)
        self.assertEqual(verdict({**job, "countries": ["Pakistan"]})[0], "PASS")

    def test_himalayas_worldwide_false_with_empty_list_is_unstructured(self):
        self.assertEqual(eligibility.location({"worldwide": False, "location_restrictions": []}, "PK", TARGETS)[2], False)

    def test_pakistan_in_ambiguous_regions(self):
        for region in ("EMEA", "APAC", "Middle East", "EMEA Only"):
            self.assertEqual(verdict({"region": region}, targets=set())[0], "FLAG", region)
        self.assertEqual(verdict({"region": "Europe Only"}, targets=set())[0], "FAIL")
        self.assertEqual(verdict({"region": "Europe Only"})[0], "FLAG")  # holds targets DE, AT...

    def test_other_bases_work_too(self):
        self.assertEqual(verdict({"region": "APAC"}, base="JP", targets=set())[0], "PASS")
        self.assertEqual(verdict({"location_restrictions": ["Canada"]}, base="CA", targets=set())[0], "PASS")

    def test_malformed_fields_are_ignored_not_crashing(self):
        self.assertEqual(eligibility.location({"location_restrictions": "Pakistan"}, "PK", TARGETS)[2], False)
        self.assertEqual(verdict({"location_restrictions": [None, 3, " ", "Pakistan"]})[0], "PASS")
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [True, "5", 5]}, 5, 1)[0], "PASS")
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [True, "5"]}, 5, 1), (None, None))


class TimeZone(unittest.TestCase):
    def test_inside_range_with_tolerance(self):
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [0, 1, 2, 3, 4]}, 5, 1)[0], "PASS")

    def test_outside_range_flags(self):
        v, note = eligibility.timezone({"timezone_restrictions": [-8, -5]}, 5, 1)
        self.assertEqual(v, "FLAG")
        self.assertIn("allowed time zones UTC-8, UTC-5; base UTC+5 is 10h from the closest", note)

    def test_wrapping_us_list_is_not_a_range(self):
        # Live Himalayas data: US roles list UTC-10..-5 plus UTC+14.
        v, note = eligibility.timezone({"timezone_restrictions": [-10, -9, -8, -7, -6, -5, 14]}, 5, 1)
        self.assertEqual(v, "FLAG")
        self.assertIn("UTC-10 to UTC-5, UTC+14; base UTC+5 is 9h", note)
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [-10, -5, 5.5, 14]}, 5, 1)[0], "PASS")

    def test_half_hour_and_exact_tolerance_edges(self):
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [5.5]}, 5, 1)[0], "PASS")  # India
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [4]}, 5, 1)[0], "PASS")    # exactly 1h
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [3.75]}, 5, 1)[0], "FLAG")
        self.assertEqual(eligibility.timezone({"timezone_restrictions": [5]}, 5, 0)[0], "PASS")

    def test_not_stated(self):
        self.assertEqual(eligibility.timezone({"timezone_restrictions": []}, 5, 1), (None, None))


class Cli(unittest.TestCase):
    def run_cli(self, payload, *extra, expect=0):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            proc = subprocess.run([sys.executable, str(TOOL), "--jobs", str(path), *extra],
                                  capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, expect, proc.stderr)
        return proc

    def test_cli_echoes_identity_and_decided_by(self):
        proc = self.run_cli({"results": [{"key": "k", "url": "https://x.test/j", "location_restrictions": ["Canada"]},
                                         {"key": "m", "location": "Remote"}]},
                            "--base", "Pakistan", "--targets", "DE,US", "--utc-offset", "5")
        rows = json.loads(proc.stdout)
        self.assertEqual((rows[0]["key"], rows[0]["location_verdict"], rows[0]["decided_by"]), ("k", "FAIL", "rules"))
        self.assertEqual((rows[1]["location_verdict"], rows[1]["decided_by"]), (None, "unstructured"))

    def test_cli_rejects_bad_input(self):
        self.assertIn("unknown country", self.run_cli([], "--base", "PK", "--targets", "DE,Narnia", "--utc-offset", "5", expect=1).stderr)
        self.assertIn("must be an object", self.run_cli([1], "--base", "PK", "--utc-offset", "5", expect=1).stderr)
        self.assertIn("JSON array", self.run_cli({"rows": []}, "--base", "PK", "--utc-offset", "5", expect=1).stderr)

    def test_base_in_targets_is_ignored(self):
        rows = json.loads(self.run_cli([{"location_restrictions": ["Canada"]}], "--base", "PK", "--targets", "PK",
                                       "--utc-offset", "5").stdout)
        self.assertEqual(rows[0]["location_verdict"], "FAIL")

    def test_cli_rejects_unknown_base(self):
        proc = self.run_cli([], "--base", "Narnia", "--utc-offset", "5", expect=1)
        self.assertIn("unknown country", proc.stderr)


if __name__ == "__main__":
    unittest.main()
