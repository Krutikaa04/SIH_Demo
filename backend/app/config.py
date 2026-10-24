"""Runtime flags shared by the API and the demo launcher."""
import os


def demo_mode():
    return os.environ.get("DEMO_MODE", "0") == "1"
