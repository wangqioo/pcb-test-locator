# PCB Test Locator

PCB Test Locator turns an Allegro IPC-2581 export into searchable test-point data and a local web view.

## Input

Export IPC-2581B XML from Allegro PCB Designer:

```text
File -> Export -> IPC-2581
```

Recommended export contents:

```text
Components, Nets, Pins/Pads, Vias, Board outline, Layers, Padstack definitions
```

## Generate Data

```powershell
python C:\Users\100448405\pcb_test_locator\ipc2581_test_locator.py D:\board.xml --out-dir C:\Users\100448405\pcb_test_locator\output --top-per-net 10
```

Outputs:

```text
output\board.json
output\recommended_testpoints_by_net.csv
output\all_testpoint_candidates.csv
output\net_summary.csv
```

## Open Web View

Double-click:

```text
start.bat
```

Or run:

```powershell
python -m http.server 8765 --directory C:\Users\100448405\pcb_test_locator
```

Open:

```text
http://127.0.0.1:8765/web/index.html
```

The web view supports net search, Top/Bottom switching, wheel zoom, drag pan, candidate filtering, board profile display, and component outlines.

## Image Overlay

The web view can overlay recommended points on a board image using a simple two-point, axis-aligned calibration:

```text
1. Load a Top or Bottom board image.
2. Enter PCB coordinates for P1 and P2 in millimeters.
3. Click Pick P1 and select the matching image point.
4. Click Pick P2 and select the matching image point.
5. Click Apply.
```

This first version assumes the image is not rotated or perspective-warped. Use board corners, tooling holes, connector pins, or known test points as calibration points.

## Scoring

Default scoring lives here:

```text
config\scoring.default.json
```

Use a custom scoring file:

```powershell
python C:\Users\100448405\pcb_test_locator\ipc2581_test_locator.py D:\board.xml --out-dir output --scoring-config C:\path\to\scoring.json
```

Common adjustments:

```text
Increase TP/R/C/L scores to prefer manual probe points.
Decrease 0402/0201 scores if they are too small for production testing.
Decrease BGA/IC scores to avoid hidden or hard-to-probe pins.
Increase via score if probe needles can reliably hit vias.
```
