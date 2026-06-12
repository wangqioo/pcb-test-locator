const state = {
  board: null,
  side: "TOP",
  query: "",
  activeNet: null,
  selectedPoint: null,
  viewBox: null,
  pan: null,
  topN: 10,
  hideVias: false,
  hideIc: false,
  showOutlines: true,
  image: null,
  pickTarget: null,
  imageCal: {
    pcb1: null,
    img1: null,
    pcb2: null,
    img2: null,
    transform: null,
  },
};

const els = {
  fileInput: document.getElementById("fileInput"),
  searchInput: document.getElementById("searchInput"),
  clearBtn: document.getElementById("clearBtn"),
  stats: document.getElementById("stats"),
  netList: document.getElementById("netList"),
  pointList: document.getElementById("pointList"),
  pointDetails: document.getElementById("pointDetails"),
  activeNet: document.getElementById("activeNet"),
  activeSummary: document.getElementById("activeSummary"),
  boardSvg: document.getElementById("boardSvg"),
  fitBtn: document.getElementById("fitBtn"),
  copyBtn: document.getElementById("copyBtn"),
  topNInput: document.getElementById("topNInput"),
  hideViaInput: document.getElementById("hideViaInput"),
  hideIcInput: document.getElementById("hideIcInput"),
  outlineInput: document.getElementById("outlineInput"),
  imageInput: document.getElementById("imageInput"),
  pcb1x: document.getElementById("pcb1x"),
  pcb1y: document.getElementById("pcb1y"),
  pcb2x: document.getElementById("pcb2x"),
  pcb2y: document.getElementById("pcb2y"),
  pickP1Btn: document.getElementById("pickP1Btn"),
  pickP2Btn: document.getElementById("pickP2Btn"),
  imgP1Text: document.getElementById("imgP1Text"),
  imgP2Text: document.getElementById("imgP2Text"),
  applyImageBtn: document.getElementById("applyImageBtn"),
  clearImageBtn: document.getElementById("clearImageBtn"),
  imageStatus: document.getElementById("imageStatus"),
};

function fmt(value, digits = 2) {
  if (value === undefined || value === null || value === "") return "";
  return Number(value).toFixed(digits);
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function loadBoard(board) {
  state.board = board;
  const firstNet = Object.keys(board.nets || {})[0] || null;
  state.activeNet = firstNet;
  state.selectedPoint = firstNet ? board.nets[firstNet].candidates[0] : null;
  fitView();
  renderAll();
}

function fitView() {
  if (!state.board) return;
  if (state.image) {
    state.viewBox = { x: 0, y: 0, w: state.image.width, h: state.image.height };
    return;
  }
  const b = state.board.bounds;
  const width = b.max_x_mm - b.min_x_mm;
  const height = b.max_y_mm - b.min_y_mm;
  const pad = Math.max(Math.max(width, height) * 0.12, 16);
  state.viewBox = {
    x: b.min_x_mm - pad,
    y: b.min_y_mm - pad,
    w: width + pad * 2,
    h: height + pad * 2,
  };
}

function sideMatches(point) {
  return state.side === "ALL" || point.side === "ALL" || point.side === state.side;
}

function isIcPoint(point) {
  const ref = String(point.refdes || "").toUpperCase();
  const pkg = String(point.package || "").toUpperCase();
  return ref.startsWith("U") || ref.startsWith("IC") || pkg.includes("BGA");
}

function pointPassesFilters(point, index) {
  if (!sideMatches(point)) return false;
  if (index >= state.topN) return false;
  if (state.hideVias && point.kind === "via") return false;
  if (state.hideIc && isIcPoint(point)) return false;
  return true;
}

function getFilteredNets() {
  if (!state.board) return [];
  const q = normalize(state.query);
  return Object.entries(state.board.nets)
    .filter(([net, info]) => {
      if (!q) return true;
      return (
        normalize(net).includes(q) ||
        info.candidates.some((p) =>
          [p.candidate, p.refdes, p.value, p.package, p.part].some((x) =>
            normalize(x).includes(q)
          )
        )
      );
    })
    .slice(0, 500);
}

function setActiveNet(net) {
  state.activeNet = net;
  const points = getVisiblePoints();
  state.selectedPoint = points[0] || null;
  renderAll();
}

function getVisiblePoints() {
  if (!state.board || !state.activeNet) return [];
  const info = state.board.nets[state.activeNet];
  if (!info) return [];
  return info.candidates.filter(pointPassesFilters);
}

function renderStats() {
  if (!state.board) return;
  const s = state.board.stats;
  els.stats.textContent = `${s.net_count} nets · ${s.component_count} components · ${s.candidate_count} candidates`;
}

function renderNetList() {
  const nets = getFilteredNets();
  els.netList.replaceChildren();
  for (const [net, info] of nets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `net-item ${net === state.activeNet ? "is-active" : ""}`;
    const best = info.candidates[0];
    button.innerHTML = `
      <span class="net-name">${net}</span>
      <span class="net-meta">${info.summary.logical_pin_count || 0} pins · ${info.summary.via_count || 0} vias${best ? ` · best ${best.candidate}` : ""}</span>
    `;
    button.addEventListener("click", () => setActiveNet(net));
    els.netList.appendChild(button);
  }
}

function renderActiveSummary() {
  if (!state.activeNet || !state.board) {
    els.activeNet.textContent = "No net selected";
    els.activeSummary.textContent = "";
    return;
  }
  const info = state.board.nets[state.activeNet];
  els.activeNet.textContent = state.activeNet;
  els.activeSummary.textContent = `${info.summary.logical_pin_count || 0} pins · ${info.summary.via_count || 0} vias`;
}

function renderPointList() {
  const points = getVisiblePoints();
  els.pointList.replaceChildren();
  for (const point of points) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `point-item ${point === state.selectedPoint ? "is-active" : ""}`;
    button.innerHTML = `
      <span class="point-title">${point.candidate} <span class="score">${point.score}</span></span>
      <span class="point-meta">${point.side} · X ${fmt(point.x_mm)} mm · Y ${fmt(point.y_mm)} mm · ${point.value || point.kind}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedPoint = point;
      renderAll();
    });
    els.pointList.appendChild(button);
  }
}

function renderDetails() {
  els.pointDetails.replaceChildren();
  const p = state.selectedPoint;
  if (!p) return;
  const rows = [
    ["Candidate", p.candidate],
    ["Net", p.net],
    ["Side", p.side],
    ["Score", p.score],
    ["X / Y mm", `${fmt(p.x_mm, 3)} / ${fmt(p.y_mm, 3)}`],
    ["RefDes", p.refdes],
    ["Pin", p.pin],
    ["Value", p.value],
    ["Package", p.package],
    ["Padstack", p.padstack],
    ["Reason", p.reason],
    ["Part", p.part],
  ];
  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = value || "-";
    els.pointDetails.append(dt, dd);
  }
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function pointsToPath(points, close = true) {
  if (!points || points.length === 0) return "";
  const mapped = points.map(([x, y]) => [x, displayY(y)]);
  const [first, ...rest] = mapped;
  return `M ${first[0]} ${first[1]} ${rest.map(([x, y]) => `L ${x} ${y}`).join(" ")}${close ? " Z" : ""}`;
}

function displayY(y) {
  if (!state.board || state.side !== "BOTTOM") return y;
  const b = state.board.bounds;
  return b.min_y_mm + b.max_y_mm - y;
}

function boardToDisplayPoint(point) {
  if (state.image && state.imageCal.transform) {
    const t = state.imageCal.transform;
    return {
      x: t.offsetX + Number(point.x_mm) * t.scaleX,
      y: t.offsetY + Number(point.y_mm) * t.scaleY,
    };
  }
  return { x: Number(point.x_mm), y: displayY(Number(point.y_mm)) };
}

function boardPathPoints(points) {
  return points.map(([x, y]) => {
    if (state.image && state.imageCal.transform) {
      const p = boardToDisplayPoint({ x_mm: x, y_mm: y });
      return [p.x, p.y];
    }
    return [x, displayY(y)];
  });
}

function renderBoard() {
  const svg = els.boardSvg;
  svg.replaceChildren();
  if (!state.board || !state.viewBox) return;
  const vb = state.viewBox;
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  if (state.image) {
    svg.appendChild(
      svgEl("image", {
        class: "board-image",
        href: state.image.url,
        x: 0,
        y: 0,
        width: state.image.width,
        height: state.image.height,
      })
    );
    renderImageCalibration(svg);
  }

  const b = state.board.bounds;
  if (!state.image && state.board.profile && state.board.profile.length) {
    for (const outline of state.board.profile) {
      svg.appendChild(
        svgEl("path", {
          class: "profile-outline",
          d: pointsToPath(outline, true),
        })
      );
    }
  } else if (!state.image) {
    svg.appendChild(
      svgEl("rect", {
        class: "board-outline",
        x: b.min_x_mm,
        y: b.min_y_mm,
        width: b.max_x_mm - b.min_x_mm,
        height: b.max_y_mm - b.min_y_mm,
        rx: 1.5,
      })
    );
  }

  if (!state.image && state.showOutlines && state.board.component_outlines) {
    const outlineLayer = svgEl("g");
    for (const c of state.board.component_outlines) {
      if (state.side !== "ALL" && c.side !== state.side) continue;
      outlineLayer.appendChild(
        svgEl("path", {
          class: "component-outline",
          d: pointsToPath(c.points, true),
        })
      );
    }
    svg.appendChild(outlineLayer);
  } else {
    const componentLayer = svgEl("g");
    const componentSample = state.board.components
      .filter((c) => state.side === "ALL" || c.side === state.side)
      .slice(0, 1800);
    for (const c of componentSample) {
      componentLayer.appendChild(
        svgEl("circle", {
          class: "component-dot",
          cx: c.x_mm,
          cy: displayY(c.y_mm),
          r: 0.38,
        })
      );
    }
    svg.appendChild(componentLayer);
  }

  const points = state.image && !state.imageCal.transform ? [] : getVisiblePoints();
  for (const p of points) {
    const selected = state.selectedPoint === p;
    const pos = boardToDisplayPoint(p);
    const dot = svgEl("circle", {
      class: `point-dot ${selected ? "is-selected" : ""}`,
      cx: pos.x,
      cy: pos.y,
      r: state.image ? (selected ? 7 : 5) : (selected ? 1.25 : 0.85),
    });
    const title = svgEl("title");
    title.textContent = `${p.net} ${p.candidate} ${p.side} X=${fmt(p.x_mm, 3)}mm Y=${fmt(p.y_mm, 3)}mm`;
    dot.appendChild(title);
    dot.addEventListener("click", () => {
      state.selectedPoint = p;
      renderAll();
    });
    svg.appendChild(dot);
    if (selected) {
      svg.appendChild(
        svgEl("text", {
          class: "point-label",
          x: pos.x + (state.image ? 10 : 1.4),
          y: pos.y - (state.image ? 10 : 1.4),
        })
      ).textContent = p.candidate;
    }
  }
}

function renderImageCalibration(svg) {
  for (const p of [state.imageCal.img1, state.imageCal.img2]) {
    if (!p) continue;
    svg.appendChild(
      svgEl("circle", {
        class: "image-cal-point",
        cx: p.x,
        cy: p.y,
        r: 8,
      })
    );
  }
}

function clientToSvgPoint(event) {
  const svg = els.boardSvg;
  const rect = svg.getBoundingClientRect();
  const vb = state.viewBox;
  return {
    x: vb.x + ((event.clientX - rect.left) / rect.width) * vb.w,
    y: vb.y + ((event.clientY - rect.top) / rect.height) * vb.h,
  };
}

function zoomAt(event) {
  if (!state.viewBox) return;
  event.preventDefault();
  const before = clientToSvgPoint(event);
  const factor = event.deltaY < 0 ? 0.82 : 1.22;
  const nextW = state.viewBox.w * factor;
  const nextH = state.viewBox.h * factor;
  const b = state.board.bounds;
  const boardW = b.max_x_mm - b.min_x_mm;
  const boardH = b.max_y_mm - b.min_y_mm;
  const minW = Math.max(boardW * 0.025, 3);
  const maxW = boardW * 8;
  if (nextW < minW || nextW > maxW) return;
  const rect = els.boardSvg.getBoundingClientRect();
  const sx = (event.clientX - rect.left) / rect.width;
  const sy = (event.clientY - rect.top) / rect.height;
  state.viewBox = {
    x: before.x - sx * nextW,
    y: before.y - sy * nextH,
    w: nextW,
    h: nextH,
  };
  renderBoard();
}

function startPan(event) {
  if (!state.viewBox || event.button !== 0) return;
  if (state.image && state.pickTarget) {
    event.preventDefault();
    const point = clientToSvgPoint(event);
    state.imageCal[state.pickTarget] = point;
    state.pickTarget = null;
    updateImageStatus("Image point picked");
    renderAll();
    return;
  }
  event.preventDefault();
  els.boardSvg.setPointerCapture(event.pointerId);
  els.boardSvg.classList.add("is-panning");
  state.pan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    viewBox: { ...state.viewBox },
  };
}

function movePan(event) {
  if (!state.pan || state.pan.pointerId !== event.pointerId) return;
  const rect = els.boardSvg.getBoundingClientRect();
  const dx = ((event.clientX - state.pan.startX) / rect.width) * state.pan.viewBox.w;
  const dy = ((event.clientY - state.pan.startY) / rect.height) * state.pan.viewBox.h;
  state.viewBox = {
    ...state.pan.viewBox,
    x: state.pan.viewBox.x - dx,
    y: state.pan.viewBox.y - dy,
  };
  renderBoard();
}

function endPan(event) {
  if (!state.pan || state.pan.pointerId !== event.pointerId) return;
  state.pan = null;
  els.boardSvg.classList.remove("is-panning");
  try {
    els.boardSvg.releasePointerCapture(event.pointerId);
  } catch (_) {
    // Pointer capture may already be released by the browser.
  }
}

function renderAll() {
  renderStats();
  renderNetList();
  renderActiveSummary();
  renderPointList();
  renderDetails();
  renderBoard();
}

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  loadBoard(JSON.parse(text));
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  const nets = getFilteredNets();
  if (!nets.some(([net]) => net === state.activeNet)) {
    state.activeNet = nets[0]?.[0] || null;
    state.selectedPoint = getVisiblePoints()[0] || null;
  }
  renderAll();
});

els.clearBtn.addEventListener("click", () => {
  state.query = "";
  els.searchInput.value = "";
  renderAll();
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode").forEach((b) => b.classList.remove("is-active"));
    button.classList.add("is-active");
    state.side = button.dataset.side;
    state.selectedPoint = getVisiblePoints()[0] || null;
    renderAll();
  });
});

function applyFilters() {
  state.topN = Math.max(1, Math.min(20, Number(els.topNInput.value) || 10));
  state.hideVias = els.hideViaInput.checked;
  state.hideIc = els.hideIcInput.checked;
  state.showOutlines = els.outlineInput.checked;
  const visiblePoints = getVisiblePoints();
  if (!visiblePoints.includes(state.selectedPoint)) {
    state.selectedPoint = visiblePoints[0] || null;
  }
  renderAll();
}

els.topNInput.addEventListener("change", applyFilters);
els.hideViaInput.addEventListener("change", applyFilters);
els.hideIcInput.addEventListener("change", applyFilters);
els.outlineInput.addEventListener("change", applyFilters);

els.fitBtn.addEventListener("click", () => {
  fitView();
  renderBoard();
});

function updateImageStatus(message) {
  els.imageStatus.textContent = message;
  els.imgP1Text.textContent = state.imageCal.img1
    ? `${fmt(state.imageCal.img1.x, 1)}, ${fmt(state.imageCal.img1.y, 1)}`
    : "not set";
  els.imgP2Text.textContent = state.imageCal.img2
    ? `${fmt(state.imageCal.img2.x, 1)}, ${fmt(state.imageCal.img2.y, 1)}`
    : "not set";
}

function readPcbCalibrationInputs() {
  const pcb1 = { x: Number(els.pcb1x.value), y: Number(els.pcb1y.value) };
  const pcb2 = { x: Number(els.pcb2x.value), y: Number(els.pcb2y.value) };
  if ([pcb1.x, pcb1.y, pcb2.x, pcb2.y].some((v) => !Number.isFinite(v))) {
    return null;
  }
  if (pcb1.x === pcb2.x || pcb1.y === pcb2.y) return null;
  return { pcb1, pcb2 };
}

function applyImageCalibration() {
  const inputs = readPcbCalibrationInputs();
  if (!state.image || !inputs || !state.imageCal.img1 || !state.imageCal.img2) {
    updateImageStatus("Need image, PCB P1/P2, and picked image P1/P2");
    return;
  }
  const { pcb1, pcb2 } = inputs;
  const { img1, img2 } = state.imageCal;
  const scaleX = (img2.x - img1.x) / (pcb2.x - pcb1.x);
  const scaleY = (img2.y - img1.y) / (pcb2.y - pcb1.y);
  state.imageCal.pcb1 = pcb1;
  state.imageCal.pcb2 = pcb2;
  state.imageCal.transform = {
    scaleX,
    scaleY,
    offsetX: img1.x - pcb1.x * scaleX,
    offsetY: img1.y - pcb1.y * scaleY,
  };
  updateImageStatus("Image calibration applied");
  renderAll();
}

els.imageInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    state.image = { url, width: image.naturalWidth, height: image.naturalHeight };
    state.imageCal = { pcb1: null, img1: null, pcb2: null, img2: null, transform: null };
    fitView();
    updateImageStatus(`${file.name} loaded`);
    renderAll();
  };
  image.src = url;
});

els.pickP1Btn.addEventListener("click", () => {
  state.pickTarget = "img1";
  updateImageStatus("Click image point for P1");
});

els.pickP2Btn.addEventListener("click", () => {
  state.pickTarget = "img2";
  updateImageStatus("Click image point for P2");
});

els.applyImageBtn.addEventListener("click", applyImageCalibration);

els.clearImageBtn.addEventListener("click", () => {
  state.image = null;
  state.pickTarget = null;
  state.imageCal = { pcb1: null, img1: null, pcb2: null, img2: null, transform: null };
  els.imageInput.value = "";
  fitView();
  updateImageStatus("No image loaded");
  renderAll();
});

els.boardSvg.addEventListener("wheel", zoomAt, { passive: false });
els.boardSvg.addEventListener("pointerdown", startPan);
els.boardSvg.addEventListener("pointermove", movePan);
els.boardSvg.addEventListener("pointerup", endPan);
els.boardSvg.addEventListener("pointercancel", endPan);

els.copyBtn.addEventListener("click", async () => {
  if (!state.selectedPoint) return;
  const p = state.selectedPoint;
  const text = `${p.net} ${p.candidate} ${p.side} X=${fmt(p.x_mm, 3)}mm Y=${fmt(p.y_mm, 3)}mm`;
  await navigator.clipboard.writeText(text);
});

fetch("../output/board.json")
  .then((res) => (res.ok ? res.json() : null))
  .then((board) => {
    if (board) loadBoard(board);
  })
  .catch(() => {});
