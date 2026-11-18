"""tools/market_trends.py: skill demand by country and month from stored facts."""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "market_trends.py"
sys.path.insert(0, str(ROOT / "tools"))
import market_trends  # noqa: E402


def job(country, month, *skills, **extra):
    return {"rank_date": f"{month}-10", "facts": {"country": country, "skills": list(skills)}, **extra}


SEEN = {
    "a": job("DE", "2026-10", "Python", "SQL"),
    "b": job("DE", "2026-11", "python", "dbt", "SQL"),
    "c": job("IE", "2026-11", "dbt", "Spark", visa_gate="FAIL"),
    "d": {"rank_date": "2026-11-01"},  # scored before facts existed: ignored
}


class Trends(unittest.TestCase):
    def test_counts_once_per_posting_and_folds_case(self):
        out = market_trends.trends(SEEN)
        self.assertEqual(out["postings"], 3)
        top = {t["skill"]: t["count"] for t in out["top_skills"]}
        self.assertEqual(top["Python"], 2)
        self.assertEqual(top["dbt"], 2, "vetoed postings still count as demand")

    def test_by_country_and_country_filter(self):
        out = market_trends.trends(SEEN)
        self.assertEqual(out["by_country"]["DE"]["postings"], 2)
        self.assertEqual(market_trends.trends(SEEN, country="IE")["postings"], 1)

    def test_movers_compare_the_last_two_months(self):
        movers = market_trends.trends(SEEN, min_count=1)["movers"]
        self.assertEqual((movers["from_month"], movers["to_month"]), ("2026-10", "2026-11"))
        dbt = next(m for m in movers["skills"] if m["skill"] == "dbt")
        self.assertEqual((dbt["from"], dbt["to"], dbt["share_change_pts"]), (0, 2, 100.0))

    def test_single_month_has_no_movers(self):
        self.assertIsNone(market_trends.trends({"a": SEEN["a"]})["movers"])

    def test_month_is_first_seen_not_the_moving_rank_date(self):
        seen = {"a": {"first_seen": "2026-09-03", "rank_date": "2026-11-18", "facts": {"skills": ["SQL"]}},
                "b": {"rank_date": "garbage", "facts": {"skills": ["SQL"]}},
                "c": {"rank_date": "2026-10-01", "facts": {"skills": ["SQL"]}}}
        out = market_trends.trends(seen, min_count=1)
        self.assertEqual(out["postings"], 3)
        self.assertEqual((out["movers"]["from_month"], out["movers"]["to_month"]), ("2026-09", "2026-10"))

    def test_multi_country_postings_get_their_own_bucket(self):
        out = market_trends.trends({"a": {"rank_date": "2026-11-01", "facts": {"skills": ["SQL"]}}})
        self.assertEqual(list(out["by_country"]), ["multi_or_unstated"])

    def test_min_count_drops_noise_and_malformed_skills_are_ignored(self):
        seen = {"a": job("DE", "2026-10", "SQL", "Go"), "b": job("DE", "2026-11", "SQL", "SQL", "Rust"),
                "c": {"rank_date": "2026-11-02", "facts": {"skills": "SQL"}},
                "d": {"rank_date": "2026-11-02", "facts": {"skills": [None, 3, " "]}}}
        movers = market_trends.trends(seen, min_count=2)["movers"]["skills"]
        self.assertEqual([m["skill"] for m in movers], [], "SQL holds 100% both months; Go/Rust are under min-count")
        self.assertEqual(market_trends.trends(seen)["postings"], 3, "a skills string is not a list; d counts with no skills")

    def test_cli_rejects_bad_flags(self):
        for args in (["--top", "0"], ["--min-count", "-1"], ["--country", "Germany"]):
            proc = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(proc.returncode, 2, args)

    def test_cli_reads_state_and_handles_missing_file(self):
        with TemporaryDirectory() as tmp:
            state = Path(tmp) / "seen_jobs.json"
            missing = subprocess.run([sys.executable, str(TOOL), "--state", str(state)],
                                     capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(json.loads(missing.stdout)["postings"], 0)
            state.write_text(json.dumps({"seen": SEEN}), encoding="utf-8")
            proc = subprocess.run([sys.executable, str(TOOL), "--state", str(state), "--country", "de"],
                                  capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["postings"], 2)


if __name__ == "__main__":
    unittest.main()
