"""Two deliberate mutants of the new local-result module; production is untouched.
Each control must fail its focused test. Not independent QA or device validation.
"""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'src/bluetooth-local-results.ts').read_text()
tests = (ROOT / 'tests/bluetooth-local-results.test.ts').read_text()
controls = [
    ('remove_generation_binding', 'LOCAL-11 ', '!same(this.#initial, c) || ', ''),
    ('promote_local_written', 'LOCAL-01 ', "outcome: 'unknown' as const,\n      historical:",
     "outcome: r.local === 'written' ? 'accepted' as const : 'unknown' as const,\n      historical:"),
]
results = []
for name, pattern, before, after in controls:
    assert source.count(before) == 1, (name, 'unique mutation anchor')
    paths = []
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=ROOT / 'src', prefix='.local-result-mutant-', suffix='.ts', delete=False) as f:
            f.write(source.replace(before, after)); module = Path(f.name); paths.append(module)
        with tempfile.NamedTemporaryFile(mode='w', dir=ROOT / 'tests', prefix='.local-result-mutant-', suffix='.test.ts', delete=False) as f:
            f.write(tests.replace("'../src/bluetooth-local-results.ts'", repr('../src/' + module.name)))
            testfile = Path(f.name); paths.append(testfile)
        run = subprocess.run(['node', '--test', '--test-reporter=tap', '--test-name-pattern', pattern, str(testfile)],
                             cwd=ROOT, text=True, capture_output=True)
        assert run.returncode != 0 and '# fail 1' in run.stdout and 'ERR_ASSERTION' in run.stdout, (name, run.stdout, run.stderr)
        results.append({'control': name, 'focused_case': pattern.strip(), 'exit_code': run.returncode,
                        'expected_failure_observed': True,
                        'tests': [line for line in run.stdout.splitlines() if line.startswith(('# tests ', '# pass ', '# fail ', 'not ok '))]})
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
output = ROOT / 'review/main-local-results/FAULT_CONTROLS.json'
output.write_text(json.dumps({'production_modified': False, 'controls': results}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'expected_failures': len(results), 'production_modified': False}))
