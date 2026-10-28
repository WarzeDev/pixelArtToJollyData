// Looks up an element by id. If index.html is missing one, a detached stand-in is returned
// (and a warning logged) so one missing element can't stop the rest of the editor working.
const missingIds = {};
function $(e) {
    const el = document.getElementById(e);
    if (el) return el;
    if (!missingIds[e]) {
        missingIds[e] = true;
        console.warn('index.html has no element with id "' + e + '" - it is out of sync with main.js');
    };
    return document.createElement(e === 'screen' || e === 'preview' ? 'canvas' : 'div');
};

function compress(obj) {
    return '<jollyData-' + LZString.compressToEncodedURIComponent(JSON.stringify(obj)) + '>';
};

function decompress(jollydata) {
    return JSON.parse(LZString.decompressFromEncodedURIComponent(jollydata.replace('<jollyData-','').replace('>','')));
}

/* ---------- Theme ---------- */

function setTheme(theme, save) {
    document.documentElement.dataset.theme = theme;
    $('theme').setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (save) {
        try { localStorage.setItem('theme', theme); } catch (e) {}
    }
};

setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);

$('theme').onclick = function() {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
};

/* ---------- Constants and state ---------- */

const MIN_SIZE = 1;
const MAX_SIZE = 128;
const MIN_IGM = 1;
const MAX_IGM = 64;
const PALETTE_MAX = 8;
const HISTORY_MAX = 100;
const MAX_ZOOM = 32;
const SHAPE_WARN = 300; // more shapes than this shows a warning after Generate
const POINT_LIMIT = 1000; // an outline with more points than this is cut off
const COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const SAVE_KEY = 'pixelArtToJollyData:v1';

const stage = $('container');
const view = $('view');
const cursor = $('cursor');
const cvs = $('screen');
const ctx = cvs.getContext('2d');
const pre = $('preview');
const prx = pre.getContext('2d');

const pvs = document.createElement('canvas');
const ptx = pvs.getContext('2d');

let w = 16; // canvas width in pixels
let h = 16; // canvas height in pixels
let color = '#888888';
let tool = 'draw';
let lastDrawTool = 'draw';
let colordata = [];
let finished_pixels;
let finalized_pixels;
let igm = 8;

let zoom = 1;
let panX = 0;
let panY = 0;

const undoStack = [];
const redoStack = [];

// Rounds to an integer inside [min, max]; returns fallback for empty / non-numeric input
function clampInt(value, min, max, fallback) {
    if (String(value).trim() === '') return fallback;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

function generateArray() {
    return Array.from({length: h}, () => Array(w).fill(0));
};

function isEmpty() {
    return colordata.every(function(row) { return row.every(function(v) { return v === 0; }); });
};

/* ---------- Autosave ---------- */

let saveTimer = null;

function saveNow() {
    clearTimeout(saveTimer);
    try {
        localStorage.setItem(SAVE_KEY, LZString.compressToUTF16(JSON.stringify({
            w: w, h: h, igm: igm, color: color, data: colordata
        })));
    } catch (e) {}
};

function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
};

window.addEventListener('pagehide', saveNow);

function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const s = JSON.parse(LZString.decompressFromUTF16(raw));
        if (!s || !Number.isInteger(s.w) || !Number.isInteger(s.h)) return null;
        if (s.w < MIN_SIZE || s.w > MAX_SIZE || s.h < MIN_SIZE || s.h > MAX_SIZE) return null;
        if (!Array.isArray(s.data) || s.data.length !== s.h) return null;
        for (const row of s.data) {
            if (!Array.isArray(row) || row.length !== s.w) return null;
            for (const v of row) {
                if (v !== 0 && !(typeof v === 'string' && COLOR_RE.test(v))) return null;
            };
        };
        s.igm = clampInt(s.igm, MIN_IGM, MAX_IGM, 8);
        s.color = (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) ? s.color.toLowerCase() : '#888888';
        return s;
    } catch (e) {
        return null;
    };
};

/* ---------- Canvas, zoom and pan ---------- */

function clampView() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    panX = Math.min(0, Math.max(W - W * zoom, panX));
    panY = Math.min(0, Math.max(H - H * zoom, panY));
};

function applyView() {
    clampView();
    view.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoom + ')';
    view.style.setProperty('--z', zoom);
};

function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
};

// cx / cy are relative to the stage's top-left corner
function zoomAt(factor, cx, cy) {
    const nz = Math.min(MAX_ZOOM, Math.max(1, zoom * factor));
    if (nz === zoom) return;
    panX = cx - (cx - panX) * nz / zoom;
    panY = cy - (cy - panY) * nz / zoom;
    zoom = nz;
    applyView();
};

function zoomCenter(factor) {
    zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2);
};

let lastStageW = stage.clientWidth;
let lastStageH = stage.clientHeight;
if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function() {
        const W = stage.clientWidth;
        const H = stage.clientHeight;
        if (!W || !H) return;
        if (lastStageW && lastStageH) {
            panX *= W / lastStageW;
            panY *= H / lastStageH;
        };
        lastStageW = W;
        lastStageH = H;
        applyView();
    }).observe(stage);
};

stage.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}, {passive: false});

$('zoom-in').onclick = function() { zoomCenter(1.5); };
$('zoom-out').onclick = function() { zoomCenter(1 / 1.5); };
$('zoom-fit').onclick = resetView;

function syncSizeUI() {
    $('wslider').value = w;
    $('wtext').value = w;
    $('hslider').value = h;
    $('htext').value = h;
    stage.style.setProperty('--w', w);
    stage.style.setProperty('--h', h);
    cursor.style.width = (100 / w) + '%';
    cursor.style.height = (100 / h) + '%';
    cursor.hidden = true;
};

// Replaces the canvas size and (optionally) its contents. Resets the zoom if the size changed.
function setCanvas(newW, newH, data) {
    const dimsChanged = newW !== w || newH !== h;
    w = newW;
    h = newH;
    cvs.width = w;
    cvs.height = h;
    pvs.width = w;
    pvs.height = h;
    pre.width = w;
    pre.height = h;
    colordata = data || generateArray();
    if (dimsChanged) resetView();
    syncSizeUI();
    redraw();
};

// Changes the size while keeping the drawing (cropped or padded). `base` is the data to copy from.
function resizeCanvas(newW, newH, base) {
    if (!base && newW === w && newH === h) {
        syncSizeUI();
        return;
    };
    const old = base || colordata;
    const next = Array.from({length: newH}, () => Array(newW).fill(0));
    const copyH = Math.min(old.length, newH);
    const copyW = Math.min(old[0].length, newW);
    for (let y = 0; y < copyH; y ++) {
        for (let x = 0; x < copyW; x ++) {
            next[y][x] = old[y][x];
        };
    };
    setCanvas(newW, newH, next);
};

function redraw() {
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y ++) {
        for (let x = 0; x < w; x ++) {
            if (colordata[y][x] !== 0) {
                ctx.fillStyle = colordata[y][x];
                ctx.fillRect(x, y, 1, 1);
            };
        };
    };
};

/* ---------- Undo / redo ---------- */

function snapshot() {
    return {w: w, h: h, data: colordata.map(function(r) { return r.slice(); })};
};

function updateHistoryButtons() {
    $('undo').disabled = undoStack.length === 0;
    $('redo').disabled = redoStack.length === 0;
};

function pushHistory(snap) {
    undoStack.push(snap);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
};

function undo() {
    if (!undoStack.length || drag || gesture) return;
    redoStack.push(snapshot());
    const s = undoStack.pop();
    setCanvas(s.w, s.h, s.data);
    updateHistoryButtons();
    saveSoon();
};

function redo() {
    if (!redoStack.length || drag || gesture) return;
    undoStack.push(snapshot());
    const s = redoStack.pop();
    setCanvas(s.w, s.h, s.data);
    updateHistoryButtons();
    saveSoon();
};

$('undo').onclick = undo;
$('redo').onclick = redo;

// A drawing action takes a snapshot first, but only enters the history once a pixel really changes
let editSnap = null;
let editPushed = false;

function beginEdit() {
    editSnap = snapshot();
    editPushed = false;
};

function touchEdit() {
    if (editSnap && !editPushed) {
        pushHistory(editSnap);
        editPushed = true;
    };
};

function endEdit() {
    const pushed = editPushed;
    editSnap = null;
    editPushed = false;
    if (pushed) saveSoon();
};

/* ---------- Color palette ---------- */

function loadPalette() {
    try {
        const saved = JSON.parse(localStorage.getItem('palette'));
        if (Array.isArray(saved)) {
            return saved
                .filter(function(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); })
                .map(function(c) { return c.toLowerCase(); })
                .filter(function(c, i, arr) { return arr.indexOf(c) === i; })
                .slice(0, PALETTE_MAX);
        };
    } catch (e) {}
    return [];
};

let palette = loadPalette();

function savePalette() {
    try { localStorage.setItem('palette', JSON.stringify(palette)); } catch (e) {}
};

function renderPalette() {
    const box = $('palette');
    box.textContent = '';
    palette.forEach(function(c) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = c;
        b.title = c.toUpperCase();
        b.setAttribute('aria-label', 'Use color ' + c.toUpperCase());
        b.setAttribute('aria-pressed', c === color);
        b.onclick = function() { setColor(c); };
        box.appendChild(b);
    });
};

// New colors go to the front; colors already in the palette keep their place
function rememberColor(c) {
    if (palette.indexOf(c) !== -1) return;
    palette = [c].concat(palette).slice(0, PALETTE_MAX);
    savePalette();
    renderPalette();
};

function setColor(c, keepTool) {
    color = c.toLowerCase();
    $('color').value = color;
    $('colortext').innerText = color.toUpperCase();
    if (!keepTool && (tool === 'erase' || tool === 'pick')) setTool('draw');
    renderPalette();
    saveSoon();
};

$('color').oninput = function() {
    setColor(this.value);
};

/* ---------- Tools ---------- */

function setTool(t) {
    tool = t;
    if (t !== 'pick') lastDrawTool = t;
    document.querySelectorAll('[data-tool]').forEach(function(b) {
        b.setAttribute('aria-pressed', b.dataset.tool === t);
    });
};

document.querySelectorAll('[data-tool]').forEach(function(b) {
    b.onclick = function() { setTool(b.dataset.tool); };
});

$('clear').onclick = function() {
    if (isEmpty()) return;
    pushHistory(snapshot());
    colordata = generateArray();
    redraw();
    saveSoon();
};

/* ---------- Start ---------- */
// Runs before the remaining event handlers are attached, so a problem further down
// can never leave the editor without a canvas.

(function init() {
    const saved = loadSave();
    if (saved) {
        setCanvas(saved.w, saved.h, saved.data);
        setIgm(saved.igm);
        setColor(saved.color, true);
    } else {
        setCanvas(16, 16);
        setIgm(8);
        setColor('#888888', true);
    };
    setTool('draw');
    renderPalette();
    updateHistoryButtons();
})();

/* ---------- Drawing (mouse, touch and pen) ---------- */

let drag = null; // {kind: 'free' | 'shape' | 'pan', ...} while a pointer is held
const touches = new Map();
let pinch = null;
let spaceDown = false;

function cellAt(e) {
    const rect = view.getBoundingClientRect();
    return {
        x: Math.floor((e.clientX - rect.left) / rect.width * w),
        y: Math.floor((e.clientY - rect.top) / rect.height * h)
    };
};

function inBounds(c) {
    return c.x >= 0 && c.x < w && c.y >= 0 && c.y < h;
};

function setCell(x, y, val) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    if (colordata[y][x] === val) return;
    touchEdit();
    colordata[y][x] = val;
    if (val === 0) {
        ctx.clearRect(x, y, 1, 1);
    } else {
        ctx.fillStyle = val;
        ctx.fillRect(x, y, 1, 1);
    };
};

function valueFor(mode) {
    return mode === 'draw' ? color : 0;
};

function lineCells(a, b) {
    const cells = [];
    let x0 = a.x;
    let y0 = a.y;
    const dx = Math.abs(b.x - x0);
    const dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1;
    const sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    while (true) {
        cells.push([x0, y0]);
        if (x0 === b.x && y0 === b.y) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; };
        if (e2 <= dx) { err += dx; y0 += sy; };
    };
    return cells;
};

// Fills the gap between two pointer events so fast strokes stay unbroken
function paintLine(a, b, mode) {
    const val = valueFor(mode);
    lineCells(a, b).forEach(function(c) { setCell(c[0], c[1], val); });
};

function shapeCells(a, b, t) {
    if (t === 'line') return lineCells(a, b);
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const cells = [];
    if (t === 'frect') {
        for (let y = y0; y <= y1; y ++) {
            for (let x = x0; x <= x1; x ++) cells.push([x, y]);
        };
        return cells;
    };
    for (let x = x0; x <= x1; x ++) {
        cells.push([x, y0]);
        if (y1 !== y0) cells.push([x, y1]);
    };
    for (let y = y0 + 1; y < y1; y ++) {
        cells.push([x0, y]);
        if (x1 !== x0) cells.push([x1, y]);
    };
    return cells;
};

function clearPreview() {
    prx.clearRect(0, 0, w, h);
};

function drawPreview() {
    clearPreview();
    if (!drag || drag.kind !== 'shape') return;
    prx.globalAlpha = 0.75;
    prx.fillStyle = drag.mode === 'draw' ? color : '#ff5555';
    shapeCells(drag.start, drag.end, drag.t).forEach(function(c) {
        prx.fillRect(c[0], c[1], 1, 1);
    });
    prx.globalAlpha = 1;
};

function floodFill(x, y, val) {
    const target = colordata[y][x];
    if (target === val) return;
    const stack = [[x, y]];
    while (stack.length) {
        const p = stack.pop();
        const px = p[0];
        const py = p[1];
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        if (colordata[py][px] !== target) continue;
        setCell(px, py, val);
        stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    };
};

function moveCursor(c) {
    if (!inBounds(c)) {
        cursor.hidden = true;
        return;
    };
    cursor.hidden = false;
    cursor.style.left = (c.x * 100 / w) + '%';
    cursor.style.top = (c.y * 100 / h) + '%';
};

function pickAt(c) {
    if (!inBounds(c)) return;
    const v = colordata[c.y][c.x];
    if (v === 0) return;
    setColor(v.slice(0, 7), true); // the picker has no alpha channel
    if (tool === 'pick') {
        setTool(lastDrawTool === 'erase' ? 'draw' : lastDrawTool);
    } else if (tool === 'erase') {
        setTool('draw');
    };
};

// Cancels the action in progress (used when a second finger turns a stroke into a pinch)
function abortDrag() {
    if (!drag) return;
    if (drag.kind === 'pan') stage.classList.remove('panning');
    if (editSnap) {
        if (editPushed) {
            undoStack.pop();
            updateHistoryButtons();
        };
        colordata = editSnap.data;
        redraw();
    };
    clearPreview();
    drag = null;
    editSnap = null;
    editPushed = false;
};

function onBar(e) {
    return e.target.closest && e.target.closest('.zoombar');
};

function startPinch() {
    const pts = Array.from(touches.values());
    const a = pts[0];
    const b = pts[1];
    pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        z: zoom,
        px: panX,
        py: panY
    };
};

function updatePinch() {
    const pts = Array.from(touches.values());
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    const rect = stage.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const nz = Math.min(MAX_ZOOM, Math.max(1, pinch.z * d / pinch.d));
    const ux = (pinch.cx - rect.left - pinch.px) / pinch.z;
    const uy = (pinch.cy - rect.top - pinch.py) / pinch.z;
    zoom = nz;
    panX = (a.x + b.x) / 2 - rect.left - ux * nz;
    panY = (a.y + b.y) / 2 - rect.top - uy * nz;
    applyView();
};

stage.addEventListener('pointerdown', function(e) {
    if (onBar(e)) return;
    if (e.pointerType === 'touch') {
        touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
        stage.setPointerCapture(e.pointerId);
        if (touches.size === 2) {
            abortDrag();
            startPinch();
            e.preventDefault();
            return;
        };
        if (touches.size > 2) return;
    };
    if (pinch) return;
    if (e.button === 1 || (spaceDown && e.button === 0)) {
        e.preventDefault();
        stage.setPointerCapture(e.pointerId);
        drag = {kind: 'pan', sx: e.clientX, sy: e.clientY, px: panX, py: panY};
        stage.classList.add('panning');
        return;
    };
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const c = cellAt(e);
    moveCursor(c);
    const mode = (e.button === 2 || tool === 'erase') ? 'erase' : 'draw';

    if (e.button === 0 && (tool === 'pick' || e.altKey)) {
        pickAt(c);
        return;
    };
    if (mode === 'draw') rememberColor(color);

    if (tool === 'fill') {
        if (inBounds(c)) {
            beginEdit();
            floodFill(c.x, c.y, valueFor(mode));
            endEdit();
        };
        return;
    };
    beginEdit();
    if (tool === 'line' || tool === 'rect' || tool === 'frect') {
        drag = {kind: 'shape', mode: mode, start: c, end: c, t: tool};
        drawPreview();
        return;
    };
    drag = {kind: 'free', mode: mode, last: c};
    paintLine(c, c, mode);
});

stage.addEventListener('pointermove', function(e) {
    if (onBar(e)) return;
    if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
        if (pinch) {
            updatePinch();
            return;
        };
    };
    if (drag && drag.kind === 'pan') {
        panX = drag.px + e.clientX - drag.sx;
        panY = drag.py + e.clientY - drag.sy;
        applyView();
        return;
    };
    const c = cellAt(e);
    moveCursor(c);
    if (!drag) return;
    if (drag.kind === 'free') {
        paintLine(drag.last, c, drag.mode);
        drag.last = c;
    } else if (drag.kind === 'shape') {
        drag.end = c;
        drawPreview();
    };
});

function endPointer(e) {
    if (onBar(e)) return;
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag) {
        if (drag.kind === 'shape' && e.type === 'pointerup') {
            const val = valueFor(drag.mode);
            shapeCells(drag.start, drag.end, drag.t).forEach(function(c) { setCell(c[0], c[1], val); });
        };
        if (drag.kind === 'pan') stage.classList.remove('panning');
        clearPreview();
        drag = null;
        endEdit();
    };
    if (e.pointerType !== 'mouse') cursor.hidden = true;
};

stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('pointerleave', function() {
    if (!drag) cursor.hidden = true;
});

stage.addEventListener('contextmenu', function(e) {
    e.preventDefault();
});
stage.addEventListener('mousedown', function(e) {
    if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
});

/* ---------- Size controls (sliders + typed numbers) ---------- */

// While a slider is dragged, every size is computed from the drawing as it was when the drag
// began, so dragging down and back up doesn't lose pixels. The whole drag is one undo step.
let gesture = null;

function sliderResize(newW, newH) {
    if (!gesture) gesture = snapshot();
    resizeCanvas(newW, newH, gesture.data);
};

function endGesture() {
    if (!gesture) return;
    if (gesture.w !== w || gesture.h !== h) {
        pushHistory(gesture);
        saveSoon();
    };
    gesture = null;
};

function typedResize(newW, newH) {
    if (newW !== w || newH !== h) {
        pushHistory(snapshot());
        resizeCanvas(newW, newH);
        saveSoon();
    };
    syncSizeUI(); // also restores the field if the typed value was invalid
};

$('wslider').oninput = function() { sliderResize(parseInt(this.value, 10), h); };
$('hslider').oninput = function() { sliderResize(w, parseInt(this.value, 10)); };
$('wslider').onchange = endGesture;
$('hslider').onchange = endGesture;

// Typed values apply on Enter / leaving the field, so typing "128" doesn't crop to 1 and 12 first
$('wtext').onchange = function() {
    typedResize(clampInt(this.value, MIN_SIZE, MAX_SIZE, w), h);
};
$('htext').onchange = function() {
    typedResize(w, clampInt(this.value, MIN_SIZE, MAX_SIZE, h));
};

function setIgm(v) {
    igm = v;
    $('igm').value = v;
    $('igmtext').value = v;
    saveSoon();
};

$('igm').oninput = function() {
    setIgm(parseInt(this.value, 10));
};
// In-game size doesn't touch the drawing, so valid typed values apply immediately
$('igmtext').oninput = function() {
    const n = Number(this.value);
    if (this.value.trim() !== '' && Number.isInteger(n) && n >= MIN_IGM && n <= MAX_IGM) {
        igm = n;
        $('igm').value = n;
        saveSoon();
    };
};
$('igmtext').onchange = function() {
    setIgm(clampInt(this.value, MIN_IGM, MAX_IGM, igm));
};

/* ---------- Transform ---------- */

function applyTransform(newW, newH, data) {
    pushHistory(snapshot());
    setCanvas(newW, newH, data);
    saveSoon();
};

function flipH() {
    if (isEmpty()) return;
    applyTransform(w, h, colordata.map(function(r) { return r.slice().reverse(); }));
};

function flipV() {
    if (isEmpty()) return;
    applyTransform(w, h, colordata.map(function(r) { return r.slice(); }).reverse());
};

function rotate(clockwise) {
    const next = Array.from({length: w}, function(_, ny) {
        return Array.from({length: h}, function(_, nx) {
            return clockwise ? colordata[h - 1 - nx][ny] : colordata[nx][w - 1 - ny];
        });
    });
    applyTransform(h, w, next);
};

// Shifts wrap around the edges, so nothing is lost
function shift(dx, dy) {
    if (isEmpty()) return;
    const next = Array.from({length: h}, function(_, y) {
        return Array.from({length: w}, function(_, x) {
            return colordata[((y - dy) % h + h) % h][((x - dx) % w + w) % w];
        });
    });
    applyTransform(w, h, next);
};

$('flip-h').onclick = flipH;
$('flip-v').onclick = flipV;
$('rot-cw').onclick = function() { rotate(true); };
$('rot-ccw').onclick = function() { rotate(false); };
$('sh-l').onclick = function() { shift(-1, 0); };
$('sh-r').onclick = function() { shift(1, 0); };
$('sh-u').onclick = function() { shift(0, -1); };
$('sh-d').onclick = function() { shift(0, 1); };

/* ---------- Output generation ---------- */

let output_obj;
let truncated = false;

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            $('output').focus();
            $('output').select();
            return document.execCommand('copy');
        } catch (e2) {
            return false;
        };
    };
};

let generating = false;

async function generateOutput() {
    if (generating) return;
    output_obj = {objects: []};
    truncated = false;
    finished_pixels = generateArray();
    finalized_pixels = generateArray();
    ptx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y ++) {
        for (let x = 0; x < w; x ++) {
            parsePixel(x, y);
        };
    };
    const count = output_obj.objects.length;
    const text = compress(output_obj);
    $('shapecount').innerText = count + (count === 1 ? ' shape' : ' shapes');

    const tooMany = count > SHAPE_WARN;
    const warn = tooMany || truncated;
    $('countline').classList.toggle('warn', warn);
    $('countuse').setAttribute('href', warn ? '#i-alert' : '#i-shapes');
    $('countline').title = warn
        ? (tooMany ? 'Lots of shapes can slow the game down. ' : '') + (truncated ? 'Some outlines were too long and got cut off.' : '')
        : '';

    $('output').value = text;
    $('outwrap').hidden = false;

    generating = true;
    const copied = await copyText(text);
    $('genlabel').innerText = copied ? 'Copied to clipboard!' : 'Generated';
    $('genicon').setAttribute('href', '#i-check');
    $('generate').classList.add('done');
    setTimeout(function() {
        $('genlabel').innerText = 'Generate';
        $('genicon').setAttribute('href', '#i-zap');
        $('generate').classList.remove('done');
        generating = false;
    }, 2000);
};

$('copy').onclick = async function() {
    const ok = await copyText($('output').value);
    if (!ok) return;
    $('copyicon').setAttribute('href', '#i-check');
    setTimeout(function() {
        $('copyicon').setAttribute('href', '#i-copy');
    }, 1500);
};

let current_x;
let current_y;
let scanned_pixel;

function checkPixel(x_diff, y_diff) {
    if (current_x + x_diff < 0 || 
        current_x + x_diff >= cvs.width || 
        current_y + y_diff < 0 || 
        current_y + y_diff >= cvs.height ||
        finalized_pixels[current_y + y_diff][current_x + x_diff] === 1) {
        return false;
    };
    if (colordata[current_y + y_diff][current_x + x_diff] === scanned_pixel) {
        finished_pixels[current_y + y_diff][current_x + x_diff] = 1;
        return true;
    };
    return false;
};

function parsePixel(x, y) {
    scanned_pixel = colordata[y][x];

    if (finished_pixels[y][x] === 1) return;

    if (scanned_pixel === 0) return;

    current_x = x;
    current_y = y;
    let current_d = 'right';
    const points = [{x: x * igm, y: y * igm}];

    let active = true;
    while (active) {
        let append = false;
        const append_x = current_x;
        const append_y = current_y;
        switch (current_d) {
            case 'right':
                if (checkPixel(0, -1)) {
                    current_y --;
                    current_d = 'up';
                    append = true;
                } else if (checkPixel(0, 0)) {
                    current_x ++;
                } else if (checkPixel(-1, 0)) {
                    current_y ++;
                    current_d = 'down';
                    append = true;
                };
                break;
            case 'up':
                if (checkPixel(-1, -1)) {
                    current_x --;
                    current_d = 'left';
                    append = true;
                } else if (checkPixel(0, -1)) {
                    current_y --;
                } else if (checkPixel(0, 0)) {
                    current_x ++;
                    current_d = 'right';
                    append = true;
                };
                break;
            case 'down':
                if (checkPixel(0, 0)) {
                    current_x ++;
                    current_d = 'right';
                    append = true;
                } else if (checkPixel(-1, 0)) {
                    current_y ++;
                } else if (checkPixel(-1, -1)) {
                    current_x --;
                    current_d = 'left';
                    append = true;
                };
                break;
            case 'left':
                if (checkPixel(-1, 0)) {
                    current_y ++;
                    current_d = 'down';
                    append = true;
                } else if (checkPixel(-1, -1)) {
                    current_x --;
                } else if (checkPixel(0, -1)) {
                    current_y --;
                    current_d = 'up';
                    append = true;
                };
                break;
        };
        if (append) {
            points.push({x: append_x * igm, y: append_y * igm});
        };
        if (current_x === x && current_y === y) {
            active = false;
        };
        if (points.length > POINT_LIMIT) {
            active = false;
            truncated = true;
        };
    };

    putOnPastry(scanned_pixel, points);

    finished_pixels[y][x] = 1;
    finalized_pixels = JSON.parse(JSON.stringify(finished_pixels));
    const new_obj = [6,0,0,0,"","",0,scanned_pixel,"#000",1,null,points,null,null,null,null,"",0,0,0,0,"",true]
    output_obj.objects.push(new_obj);
};

function putOnPastry(color, points) {
    let min_x = w;
    let min_y = h;
    let max_x = 0;
    let max_y = 0;
    for (let i = 0; i < points.length; i ++) {
        const x = points[i].x / igm;
        const y = points[i].y / igm;
        min_x = Math.min(min_x, x)
        max_x = Math.max(max_x, x)
        min_y = Math.min(min_y, y)
        max_y = Math.max(max_y, y)
        if (i === 0) {
            ptx.beginPath(x, y);
        };
        ptx.lineTo(x, y);
    };
    ptx.fillStyle = color;
    ptx.fill();
    const d_width = max_x - min_x;
    const d_height = max_y - min_y;
    const data = ptx.getImageData(min_x, min_y, d_width, d_height).data;
    let index = 0;
    for (let i = 0; i < data.length; i += 4) {
        const check_x = min_x + (index % d_width);
        const check_y = min_y + Math.floor(index / d_width);
        if (finished_pixels[check_y][check_x] === 0) {
            if (colordata[check_y][check_x] === rgbToHex(data[i], data[i + 1], data[i + 2], data[i + 3])) {
                finished_pixels[check_y][check_x] = 1;
            };
        } else {
            if (colordata[check_y][check_x] !== rgbToHex(data[i], data[i + 1], data[i + 2], data[i + 3])) {
                finished_pixels[check_y][check_x] = 0;
            };
        }
        index ++;
    };
};

/* ---------- Image import / export ---------- */

// Resolves to 'resize', 'keep' or 'cancel'
function askResize(iw, ih) {
    const dlg = $('resizedlg');
    const crops = iw > w || ih > h;
    const msg = 'The image is ' + iw + ' × ' + ih + ' px and the canvas is ' + w + ' × ' + h + ' px.' +
        (crops ? ' Keeping the current size will crop the parts of the image outside the canvas.' : '');

    if (typeof dlg.showModal !== 'function') {
        return Promise.resolve(confirm(msg + '\n\nResize the canvas to ' + iw + ' × ' + ih + '?') ? 'resize' : 'keep');
    };

    return new Promise(function(resolve) {
        $('resizemsg').textContent = msg;
        $('resize-yes').textContent = 'Resize canvas to ' + iw + ' × ' + ih;
        $('resize-no').textContent = 'Keep ' + w + ' × ' + h;
        dlg.returnValue = '';
        dlg.addEventListener('close', function() {
            resolve(dlg.returnValue || 'cancel'); // Escape closes with an empty value
        }, {once: true});
        dlg.showModal();
    });
};

// Clicking the dimmed backdrop closes a dialog
['resizedlg', 'datadlg'].forEach(function(id) {
    $(id).addEventListener('click', function(e) {
        if (e.target === this) this.close('cancel');
    });
});

async function importImage(img) {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    let doResize = false;
    if ((iw !== w || ih !== h) && iw <= MAX_SIZE && ih <= MAX_SIZE) {
        const choice = await askResize(iw, ih);
        if (choice === 'cancel') return;
        doResize = choice === 'resize';
    };
    const snap = snapshot();
    if (doResize) resizeCanvas(iw, ih);
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0);
    const data = tctx.getImageData(0, 0, w, h).data;
    let p = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 0) {
            colordata[Math.floor(p / w)][p % w] = rgbToHex(data[i], data[i + 1], data[i + 2], data[i + 3]);
        };
        p ++;
    };
    pushHistory(snap);
    redraw();
    saveSoon();
};

$('image').onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
        const img = new Image();
        img.onload = function() {
            importImage(img);
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
    this.value = ''; // lets the same file be imported again
};

// Exported at 1:1 so the file can be imported again
$('export').onclick = function() {
    cvs.toBlob(function(blob) {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pixel-art.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
};

/* ---------- JollyData import ---------- */

function gcd(a, b) {
    while (b) {
        const t = a % b;
        a = b;
        b = t;
    };
    return a;
};

// Reads shapes made by this tool (type 6 polygons) and redraws them as pixels
function importJolly(text) {
    let obj = null;
    try { obj = decompress(text.trim()); } catch (e) {}
    if (!obj || !Array.isArray(obj.objects)) throw new Error('Not valid JollyData');

    const shapes = [];
    for (const o of obj.objects) {
        if (!Array.isArray(o) || o[0] !== 6 || typeof o[7] !== 'string' || !COLOR_RE.test(o[7])) continue;
        const pts = o[11];
        if (!Array.isArray(pts) || pts.length < 3) continue;
        if (!pts.every(function(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0; })) continue;
        shapes.push({color: o[7].toLowerCase(), pts: pts});
    };
    if (!shapes.length) throw new Error('No shapes found');

    // Work out how many game units make one pixel: keep the current setting if it fits
    let unit = igm;
    const fits = shapes.every(function(s) {
        return s.pts.every(function(p) { return p.x % igm === 0 && p.y % igm === 0; });
    });
    if (!fits) {
        let g = 0;
        shapes.forEach(function(s) {
            s.pts.forEach(function(p) { g = gcd(gcd(g, Math.round(p.x)), Math.round(p.y)); });
        });
        unit = 1;
        for (let d = MAX_IGM; d >= 1; d --) {
            if (g > 0 && g % d === 0) { unit = d; break; };
        };
    };

    let maxX = 0;
    let maxY = 0;
    shapes.forEach(function(s) {
        s.pts.forEach(function(p) {
            maxX = Math.max(maxX, p.x / unit);
            maxY = Math.max(maxY, p.y / unit);
        });
    });
    const nw = Math.min(MAX_SIZE, Math.max(w, Math.ceil(maxX), MIN_SIZE));
    const nh = Math.min(MAX_SIZE, Math.max(h, Math.ceil(maxY), MIN_SIZE));

    const tmp = document.createElement('canvas');
    tmp.width = nw;
    tmp.height = nh;
    const tctx = tmp.getContext('2d', {willReadFrequently: true});
    const data = Array.from({length: nh}, () => Array(nw).fill(0));
    shapes.forEach(function(s) {
        tctx.clearRect(0, 0, nw, nh);
        tctx.beginPath();
        s.pts.forEach(function(p, i) {
            if (i === 0) tctx.moveTo(p.x / unit, p.y / unit);
            else tctx.lineTo(p.x / unit, p.y / unit);
        });
        tctx.closePath();
        tctx.fill();
        const px = tctx.getImageData(0, 0, nw, nh).data;
        for (let i = 0; i < nw * nh; i ++) {
            if (px[i * 4 + 3] > 127) data[Math.floor(i / nw)][i % nw] = s.color;
        };
    });

    pushHistory(snapshot());
    setCanvas(nw, nh, data);
    setIgm(unit);
    saveSoon();
};

$('importdata').onclick = function() {
    $('datain').value = '';
    $('dataerr').hidden = true;
    $('datadlg').showModal();
    $('datain').focus();
};

$('data-go').onclick = function() {
    try {
        importJolly($('datain').value);
        $('datadlg').close('done');
    } catch (err) {
        $('dataerr').textContent = err.message;
        $('dataerr').hidden = false;
    };
};

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', function(e) {
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t.matches && t.matches('input[type="number"], textarea')) return;
    const key = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
        } else if (key === 'y') {
            e.preventDefault();
            redo();
        };
        return;
    };
    if (e.altKey) return;

    const onRange = t.matches && t.matches('input[type="range"], select');
    if (key === ' ') {
        e.preventDefault();
        spaceDown = true;
        stage.classList.add('pan');
        return;
    };
    if (key.indexOf('arrow') === 0) {
        if (onRange) return;
        e.preventDefault();
        if (e.repeat) return;
        if (key === 'arrowleft') shift(-1, 0);
        if (key === 'arrowright') shift(1, 0);
        if (key === 'arrowup') shift(0, -1);
        if (key === 'arrowdown') shift(0, 1);
        return;
    };
    switch (key) {
        case 'd': setTool('draw'); break;
        case 'e': setTool('erase'); break;
        case 'f': setTool('fill'); break;
        case 'l': setTool('line'); break;
        case 'r': setTool(e.shiftKey ? 'frect' : 'rect'); break;
        case 'i': setTool('pick'); break;
        case '[': setIgm(clampInt(igm - 1, MIN_IGM, MAX_IGM, igm)); break;
        case ']': setIgm(clampInt(igm + 1, MIN_IGM, MAX_IGM, igm)); break;
        case '+':
        case '=': zoomCenter(1.5); break;
        case '-': zoomCenter(1 / 1.5); break;
        case '0': resetView(); break;
    };
});

document.addEventListener('keyup', function(e) {
    if (e.key !== ' ') return;
    spaceDown = false;
    stage.classList.remove('pan');
    // stops Space from "clicking" a focused button
    if (e.target.matches && e.target.matches('button')) e.preventDefault();
});

/* ---------- Helpers ---------- */

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
};
  
function rgbToHex(r, g, b, a = 255) {
    const alpha_append = (a === 255 ? '' : componentToHex(a));
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b) + alpha_append;
};

$('generate').onclick = generateOutput;