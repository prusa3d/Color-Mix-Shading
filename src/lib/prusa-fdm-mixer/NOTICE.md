# Vendored: prusa-fdm-mixer

The files in this directory (`prusa-fdm-mixer.ts`, `yule-nielsen.ts`, `color.ts`)
are copied **verbatim** from the [`prusa-fdm-mixer`](https://github.com/prusa-research/prusa-fdm-mixer)
project (the minimal subset needed to call `mixFilaments`).

- Upstream repo: https://github.com/prusa-research/prusa-fdm-mixer
- Original author: Ondrej Bartas (Prusa Research s.r.o.) and contributors
- License: MIT (see `LICENSE` in this directory)

`mixFilaments` predicts the visible color of multi-color FDM 3D prints,
calibrated against measured Prusa XL filament data. We use it here to
preview how two light contributions combine into a printable mixed color.

If you need to update these files, copy the latest versions from the
upstream `src/` directory rather than editing them in place.
