"""Run the demo smoke suite against an isolated launcher process, then stop it."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8000/api"


def wait_for_server(server, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"Demo server exited with status {server.returncode}")
        try:
            with urllib.request.urlopen(BASE + "/clock", timeout=1) as response:
                if response.status == 200:
                    time.sleep(0.1)
                    if server.poll() is not None:
                        raise RuntimeError("Demo server could not bind its port")
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.1)
    raise TimeoutError("Demo server did not become ready within 30 seconds")


def main():
    with tempfile.TemporaryDirectory(prefix="sih-ci-") as temporary:
        env = dict(os.environ, AICTE_DB=str(Path(temporary) / "demo.db"), DEMO_MODE="1")
        with (Path(temporary) / "server.log").open("w+") as log:
            server = subprocess.Popen([sys.executable, "run.py", "--no-browser"], cwd=ROOT,
                                      env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            try:
                wait_for_server(server)
                result = subprocess.run([sys.executable, "scripts/smoke_test.py", BASE], cwd=ROOT, env=env)
                return result.returncode
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
