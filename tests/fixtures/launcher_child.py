from __future__ import annotations

import sys
import time
from pathlib import Path


stop_file = Path(sys.argv[1])
print("fixture ready", flush=True)
while not stop_file.exists():
    time.sleep(0.05)
print("fixture stopped", flush=True)
