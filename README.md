# Ideogram Local Studio

Electron desktop app for running Ideogram 4 locally with the official PyTorch runtime.

This repository intentionally does **not** include model weights. The app expects local Hugging Face model folders under `models/`.

## Included Example Gallery

Two generated example images are included in `outputs/` so the Gallery has content immediately after first launch:

- `outputs/example-local-ai-is-king-1024.png`
- `outputs/example-mountain-lake-1024.png`

New generated images are also written to `outputs/`, but `.gitignore` keeps normal generated output out of Git.

## Requirements

- macOS on Apple Silicon is the tested target.
- Node.js 20+.
- Python 3.12 recommended.
- Hugging Face account with access to the Ideogram 4 repositories.
- About 30 GB free disk space for FP8 weights, more if you also download NF4.
- Enough unified memory for local inference. This was tested on an M4 Max with 128 GB.

## Hugging Face Login And Weight Download

First create the local Python runtime. This installs the Hugging Face CLI inside `.venv/`:

```bash
./scripts/bootstrap-runtime.sh
```

Accept the model terms and request access on Hugging Face before downloading:

- https://huggingface.co/ideogram-ai/ideogram-4-fp8
- https://huggingface.co/ideogram-ai/ideogram-4-nf4

Then log in. The command will prompt for your Hugging Face access token:

```bash
.venv/bin/huggingface-cli login
```

Use a **read** token from Hugging Face. Do not commit tokens, `.env` files, shell history dumps, or downloaded model folders.

Alternative non-interactive login for CI or a temporary shell:

```bash
export HF_TOKEN="hf_your_token_here"
```

With either login method, download the weights directly into the paths expected by the app.

Recommended Apple Silicon model:

```bash
.venv/bin/huggingface-cli download ideogram-ai/ideogram-4-fp8 \
  --local-dir models/ideogram-4-fp8 \
  --local-dir-use-symlinks False
```

Optional NF4 model:

```bash
.venv/bin/huggingface-cli download ideogram-ai/ideogram-4-nf4 \
  --local-dir models/ideogram-4-nf4 \
  --local-dir-use-symlinks False
```

Expected layout:

```text
models/
  ideogram-4-fp8/
    model_index.json
    ...
  ideogram-4-nf4/
    model_index.json
    ...
```

On Apple Silicon, use `Ideogram 4 FP8 - Apple Silicon` in the UI. NF4 is visible for completeness, but the official NF4 loader requires CUDA/bitsandbytes and is not the recommended local Mac path.

## Install

Install Electron dependencies:

```bash
npm install
```

Create the Python runtime and install backend dependencies:

```bash
./scripts/bootstrap-runtime.sh
```

Download the FP8 weights as described above, then start the app:

```bash
npm run dev
```

The local API is available while the app is running:

```text
http://127.0.0.1:7860/health
http://127.0.0.1:7860/gallery
http://127.0.0.1:7860/generate
```

## Verify

Check the Python runtime and model paths:

```bash
npm run check:backend
```

Run the renderer interaction smoke test:

```bash
npm run test:ui
```

With the app running, test the local API and Gallery delete-to-trash path:

```bash
npm run test:api
```

Create UI screenshots:

```bash
npm run capture:ui
CAPTURE_VIEW=gallery npm run capture:ui
```

## Notes

- Generated images are saved to `outputs/`.
- Gallery deletion moves files to the macOS Trash instead of hard-deleting them.
- The app uses an isolated Electron profile under `.electron-profile/`.
- The app sets Chromium's mock keychain switch, so generation does not require macOS Keychain access.
- `models/`, `.venv/`, `node_modules/`, Electron profiles, logs, and normal generated outputs are ignored by Git.
