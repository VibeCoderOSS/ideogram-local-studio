from __future__ import annotations

from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
os.environ["IDEOGRAM_STUDIO_ROOT"] = str(ROOT)
sys.path.insert(0, str(ROOT))

from backend.worker import generate  # noqa: E402


generate(
  {
    "jobId": "smoke",
    "root": str(ROOT),
    "outputsDir": str(ROOT / "outputs"),
    "prompt": "A small blue ceramic cup on a clean wooden table, soft daylight",
    "negativePrompt": "low quality, blurry, watermark",
    "quantization": "fp8",
    "modelPath": str(ROOT / "models" / "ideogram-4-fp8"),
    "sampler": "V4_TURBO_12",
    "seed": 1234,
    "width": 256,
    "height": 256,
    "device": "auto",
    "dtype": "bfloat16",
    "structuredCaption": True,
  }
)
