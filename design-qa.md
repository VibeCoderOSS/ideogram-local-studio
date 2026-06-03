# Design QA

final result: passed

Reference:
- `/Volumes/Quick_SSD/0_Vibe_Apps/Ideogram/Referenzbild/Referenzidee.png`

Implementation capture:
- `/Volumes/Quick_SSD/0_Vibe_Apps/Ideogram/design/current-ui-normalized.png`

Checks:
- Dark macOS-style app shell, hidden titlebar, traffic lights, centered title, and unified-memory pill match the reference structure.
- Left navigation, active Generation item, status card, and footer controls match the reference layout and visual weight.
- Main Generation panel includes prompt, negative prompt, model/sampler, sliders, seed controls, size/aspect controls, batch controls, and Generate action.
- Right column includes large image preview, action buttons, Generation Info panel, Recent Generations strip, and runtime log.
- Controls are interactive in renderer code; Electron IPC connects generation to a persistent Python worker.
- Runtime doctor passed with `.venv`, Torch `2.12.0`, Transformers `5.10.1`, local FP8/NF4 model paths, and `mps: true`.
- End-to-end smoke generation passed using local `models/ideogram-4-fp8` on `mps`, `256x256`, `V4_TURBO_12`, seed `1234`.

Runtime evidence:
- Smoke output: `/Volumes/Quick_SSD/0_Vibe_Apps/Ideogram/outputs/ideogram4_1780511973_256x256_seed1234.png`
- Smoke duration after model load: `23.51s`

Notes:
- FP8 on Apple Silicon required two local compatibility patches to the official vendored Ideogram loader: dequantize FP8 linears for MPS and evaluate the float64 scheduler scalar on CPU.
- NF4 remains visible but is CUDA-only in the official runtime; the UI warns accordingly.
- Electron uses an isolated local profile plus `use-mock-keychain`; Keychain access is not required and should not be approved.
