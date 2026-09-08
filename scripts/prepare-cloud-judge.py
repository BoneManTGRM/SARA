"""Judge-only dataset admission. This script must never run in a producer job."""
import argparse
import importlib.util
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--dataset", type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("pilot", Path(__file__).with_name("swe-bench-pilot.py"))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
rows = pilot.load_rows(args.dataset)
if pilot.manifest(rows) != json.loads(Path("docs/benchmarks/swe-bench-multilingual-pilot.json").read_text()):
    raise ValueError("Frozen judge selection drift")
print("Judge-only dataset matches the frozen pilot; no producer data exported.")
