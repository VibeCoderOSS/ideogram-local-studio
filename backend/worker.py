from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any


ROOT = Path(os.environ.get("IDEOGRAM_STUDIO_ROOT", Path.cwd())).resolve()
VENDOR_SRC = ROOT / "vendor" / "ideogram4" / "src"
if VENDOR_SRC.exists():
  sys.path.insert(0, str(VENDOR_SRC))

PIPE_CACHE: dict[tuple[str, str, str], Any] = {}


def emit(event: dict[str, Any]) -> None:
  print(json.dumps(event, ensure_ascii=False), flush=True)


def resolve_model_path(root: Path, quantization: str, model_path: str | None) -> Path:
  if model_path:
    path = Path(model_path)
    if not path.is_absolute():
      path = root / path
    return path.resolve()
  return (root / "models" / f"ideogram-4-{quantization}").resolve()


def make_local_caption(prompt: str, negative_prompt: str = "", medium: str = "photograph") -> str:
  prompt = prompt.strip()
  negative_prompt = negative_prompt.strip()
  avoid = f" Avoid these qualities: {negative_prompt}." if negative_prompt else ""
  caption = OrderedDict()
  caption["high_level_description"] = f"{prompt}{avoid}"
  caption["style_description"] = OrderedDict(
    [
      ("aesthetics", "high detail, clean composition, professional image generation"),
      ("lighting", "balanced cinematic lighting with clear subject separation"),
      ("photo", "sharp focus, natural perspective, high dynamic range"),
      ("medium", medium),
      ("color_palette", ["#0B0F14", "#1D4ED8", "#F8FAFC", "#F59E0B", "#22C55E"]),
    ]
  )
  caption["compositional_deconstruction"] = OrderedDict(
    [
      ("background", f"Scene context and environment described by the prompt: {prompt}"),
      (
        "elements",
        [
          OrderedDict(
            [
              ("type", "obj"),
              ("bbox", [0, 0, 1000, 1000]),
              ("desc", f"Primary visual subject and all key details: {prompt}{avoid}"),
            ]
          )
        ],
      ),
    ]
  )
  return json.dumps(caption, separators=(",", ":"), ensure_ascii=False)


def patch_hf_local_download() -> None:
  import ideogram4.pipeline_ideogram4 as pipeline_module
  from huggingface_hub.errors import EntryNotFoundError

  original = pipeline_module.hf_hub_download

  def local_hf_hub_download(repo_id: str, filename: str, *args: Any, **kwargs: Any) -> str:
    repo_path = Path(repo_id)
    if repo_path.exists() and repo_path.is_dir():
      local_path = repo_path / filename
      if local_path.exists():
        return str(local_path)
      raise EntryNotFoundError(f"Missing local model file: {local_path}")
    return original(repo_id=repo_id, filename=filename, *args, **kwargs)

  pipeline_module.hf_hub_download = local_hf_hub_download


def load_pipe(model_path: Path, quantization: str, device: str, dtype_name: str, job_id: str):
  import torch
  from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig

  patch_hf_local_download()

  dtype = getattr(torch, dtype_name)
  key = (str(model_path), device, dtype_name)
  if key in PIPE_CACHE:
    emit({"type": "progress", "jobId": job_id, "phase": "model-ready", "message": "Using warm model cache"})
    return PIPE_CACHE[key]

  emit({"type": "progress", "jobId": job_id, "phase": "load", "message": f"Loading {quantization.upper()} weights on {device}"})
  pipe = Ideogram4Pipeline.from_pretrained(
    config=Ideogram4PipelineConfig(weights_repo=str(model_path)),
    device=device,
    dtype=dtype,
  )
  PIPE_CACHE[key] = pipe
  emit({"type": "progress", "jobId": job_id, "phase": "model-ready", "message": "Model loaded and cached"})
  return pipe


def choose_device(requested: str | None = None) -> str:
  import torch

  if requested and requested != "auto":
    return requested
  if torch.cuda.is_available():
    return "cuda"
  if torch.backends.mps.is_available():
    return "mps"
  return "cpu"


def run_doctor(job_id: str, root: Path) -> None:
  info: dict[str, Any] = {
    "python": sys.executable,
    "platform": platform.platform(),
    "root": str(root),
    "vendorIdeogram4": (root / "vendor" / "ideogram4").exists(),
    "fp8Model": (root / "models" / "ideogram-4-fp8" / "model_index.json").exists(),
    "nf4Model": (root / "models" / "ideogram-4-nf4" / "model_index.json").exists(),
  }
  try:
    import torch
    info["torch"] = torch.__version__
    info["mps"] = bool(torch.backends.mps.is_available())
    info["cuda"] = bool(torch.cuda.is_available())
  except Exception as exc:
    info["torchError"] = str(exc)

  for module in ["transformers", "accelerate", "safetensors", "huggingface_hub", "bitsandbytes", "ideogram4"]:
    try:
      imported = __import__(module)
      info[module] = getattr(imported, "__version__", "installed")
    except Exception as exc:
      info[module] = f"missing: {exc}"

  emit({"type": "done", "jobId": job_id, "doctor": info})


def generate(request: dict[str, Any]) -> None:
  import torch
  from ideogram4 import PRESETS

  job_id = request["jobId"]
  root = Path(request.get("root") or ROOT).resolve()
  outputs_dir = Path(request.get("outputsDir") or root / "outputs").resolve()
  outputs_dir.mkdir(parents=True, exist_ok=True)

  quantization = request.get("quantization", "fp8")
  model_path = resolve_model_path(root, quantization, request.get("modelPath"))
  if not model_path.exists():
    raise FileNotFoundError(f"Model path does not exist: {model_path}")

  device = choose_device(request.get("device", "auto"))
  if quantization == "nf4" and device != "cuda":
    raise RuntimeError("NF4 weights require CUDA/bitsandbytes. Use FP8 on Apple Silicon.")

  dtype_name = request.get("dtype", "bfloat16")
  width = int(request.get("width", 1024))
  height = int(request.get("height", 1024))
  if width % 16 or height % 16:
    raise ValueError("Width and height must be multiples of 16.")

  prompt = str(request.get("prompt", "")).strip()
  if not prompt:
    raise ValueError("Prompt is empty.")

  negative_prompt = str(request.get("negativePrompt", "")).strip()
  use_structured = bool(request.get("structuredCaption", True))
  caption = make_local_caption(prompt, negative_prompt) if use_structured else prompt

  sampler = request.get("sampler", "V4_DEFAULT_20")
  steps = int(request.get("steps", 20))
  cfg = float(request.get("cfgScale", 7.0))
  seed = int(request.get("seed", 0))
  if seed < 0:
    seed = int(time.time()) % 2_147_483_647
  batch_count = max(1, int(request.get("batchCount", 1)))
  batch_size = max(1, int(request.get("batchSize", 1)))
  total_images = batch_count * batch_size

  pipe = load_pipe(model_path, quantization, device, dtype_name, job_id)

  emit({"type": "progress", "jobId": job_id, "phase": "generate", "message": f"Generating {width}x{height} with seed {seed}"})

  if sampler in PRESETS:
    preset = PRESETS[sampler]
    call_kwargs = {
      "num_steps": preset.num_steps,
      "guidance_schedule": preset.guidance_schedule,
      "mu": preset.mu,
      "std": preset.std,
    }
  else:
    call_kwargs = {
      "num_steps": steps,
      "guidance_scale": cfg,
    }

  started = time.time()
  output_paths: list[str] = []
  for image_index in range(total_images):
    image_seed = seed + image_index
    emit(
      {
        "type": "progress",
        "jobId": job_id,
        "phase": "sample",
        "message": f"Image {image_index + 1}/{total_images}, seed {image_seed}",
      }
    )
    images = pipe(
      caption,
      height=height,
      width=width,
      seed=image_seed,
      raise_on_caption_issues=False,
      **call_kwargs,
    )
    filename = f"ideogram4_{int(started)}_{width}x{height}_seed{image_seed}.png"
    output_path = outputs_dir / filename
    images[0].save(output_path)
    output_paths.append(str(output_path))

  if device == "mps" and hasattr(torch, "mps"):
    try:
      torch.mps.empty_cache()
    except Exception:
      pass

  emit(
    {
      "type": "done",
      "jobId": job_id,
      "outputPath": output_paths[0],
      "outputPaths": output_paths,
      "duration": round(time.time() - started, 2),
      "seed": seed,
      "width": width,
      "height": height,
      "sampler": sampler,
      "quantization": quantization,
      "device": device,
    }
  )


def handle(request: dict[str, Any]) -> None:
  job_id = request.get("jobId", "unknown")
  try:
    command = request.get("command")
    if command == "doctor":
      run_doctor(job_id, Path(request.get("root") or ROOT).resolve())
    elif command == "generate":
      generate(request)
    else:
      raise ValueError(f"Unknown command: {command}")
  except Exception as exc:
    emit({"type": "error", "jobId": job_id, "message": str(exc)})


def main_loop() -> None:
  emit({"type": "ready", "jobId": "worker", "message": "Ideogram worker ready"})
  for line in sys.stdin:
    line = line.strip()
    if not line:
      continue
    try:
      handle(json.loads(line))
    except Exception as exc:
      emit({"type": "error", "jobId": "parse", "message": str(exc)})


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--doctor", action="store_true")
  args = parser.parse_args()
  if args.doctor:
    run_doctor("doctor", ROOT)
  else:
    main_loop()


if __name__ == "__main__":
  main()
