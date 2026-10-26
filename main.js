function $(e) {return document.getElementById(e);};

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

/* ---------- Canvas ---------- */

const stage = $('container');
const cursor = $('cursor');
const cvs = $('screen');
const ctx = cvs.getContext('2d');

const pvs = document.createElement('canvas');
const ptx = pvs.getContext('2d');

let size = 16;
let color = '#888888';
let tool = 'draw';
let colordata;
let finished_pixels;
let finalized_pixels;
let igm = 8;

function generateCanvas(sizeParam) {
    size = sizeParam;
    cvs.width = size;
    cvs.height = size;
    pvs.width = size;
    pvs.height = size;
    $('sizetext').innerText = size + ' × ' + size;
    stage.style.setProperty('--n', size);
    cursor.style.width = (100 / size) + '%';
    cursor.style.height = (100 / size) + '%';
    colordata = generateArray();
};

function generateArray() {
    return Array(size).fill().map(() => Array(size).fill(0));
};

generateCanvas(16);

function redraw() {
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < size; y ++) {
        for (let x = 0; x < size; x ++) {
            if (colordata[y][x] !== 0) {
                ctx.fillStyle = colordata[y][x];
                ctx.fillRect(x, y, 1, 1);
            };
        };
    };
};

/* ---------- Drawing (mouse, touch and pen) ---------- */

let stroke = null; // 'draw' | 'erase' while a button is held
let last = null;

function cellAt(e) {
    const rect = stage.getBoundingClientRect();
    return {
        x: Math.floor((e.clientX - rect.left) / rect.width * size),
        y: Math.floor((e.clientY - rect.top) / rect.height * size)
    };
};

function inBounds(c) {
    return c.x >= 0 && c.x < size && c.y >= 0 && c.y < size;
};

function paint(x, y, mode) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    if (mode === 'draw') {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
        colordata[y][x] = color;
    } else {
        ctx.clearRect(x, y, 1, 1);
        colordata[y][x] = 0;
    };
};

// Fills the gap between two pointer events so fast strokes stay unbroken
function paintLine(a, b, mode) {
    let x0 = a.x;
    let y0 = a.y;
    const dx = Math.abs(b.x - x0);
    const dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1;
    const sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    while (true) {
        paint(x0, y0, mode);
        if (x0 === b.x && y0 === b.y) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; };
        if (e2 <= dx) { err += dx; y0 += sy; };
    };
};

function moveCursor(c) {
    if (!inBounds(c)) {
        cursor.hidden = true;
        return;
    };
    cursor.hidden = false;
    cursor.style.left = (c.x * 100 / size) + '%';
    cursor.style.top = (c.y * 100 / size) + '%';
};

stage.addEventListener('pointerdown', function(e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    stroke = (e.button === 2 || tool === 'erase') ? 'erase' : 'draw';
    const c = cellAt(e);
    last = c;
    moveCursor(c);
    paintLine(c, c, stroke);
});

stage.addEventListener('pointermove', function(e) {
    const c = cellAt(e);
    moveCursor(c);
    if (stroke) {
        paintLine(last, c, stroke);
        last = c;
    };
});

function endStroke(e) {
    stroke = null;
    last = null;
    if (e.pointerType !== 'mouse') cursor.hidden = true;
};

stage.addEventListener('pointerup', endStroke);
stage.addEventListener('pointercancel', endStroke);
stage.addEventListener('pointerleave', function() {
    if (!stroke) cursor.hidden = true;
});

stage.addEventListener('contextmenu', function(e) {
    e.preventDefault();
});

/* ---------- Tools ---------- */

function setTool(t) {
    tool = t;
    $('tool-draw').setAttribute('aria-pressed', t === 'draw');
    $('tool-erase').setAttribute('aria-pressed', t === 'erase');
};

$('tool-draw').onclick = function() { setTool('draw'); };
$('tool-erase').onclick = function() { setTool('erase'); };

$('clear').onclick = function() {
    colordata = generateArray();
    redraw();
};

$('color').oninput = function() {
    color = this.value;
    $('colortext').innerText = this.value.toUpperCase();
    setTool('draw');
};
$('color').value = '#888888';

$('size').oninput = function() {
    generateCanvas(parseInt(this.value));
};
$('size').value = 16;

$('igm').oninput = function() {
    igm = parseInt(this.value, 10);
    $('igmtext').innerText = igm;
};
$('igm').value = 8;

/* ---------- Output generation ---------- */

let output_obj;

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
    finished_pixels = generateArray(size);
    finalized_pixels = generateArray(size);
    ptx.clearRect(0, 0, size, size);
    for (let y = 0; y < size; y ++) {
        for (let x = 0; x < size; x ++) {
            parsePixel(x, y);
        };
    };
    const count = output_obj.objects.length;
    const text = compress(output_obj);
    $('shapecount').innerText = count + (count === 1 ? ' shape' : ' shapes');
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
        if (points.length > 1000) {
            active = false;
        };
    };

    putOnPastry(scanned_pixel, points);

    finished_pixels[y][x] = 1;
    finalized_pixels = JSON.parse(JSON.stringify(finished_pixels));
    const new_obj = [6,0,0,0,"","",0,scanned_pixel,"#000",1,null,points,null,null,null,null,"",0,0,0,0,"",true]
    output_obj.objects.push(new_obj);
};

function putOnPastry(color, points) {
    let min_x = size;
    let min_y = size;
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

/* ---------- Image import ---------- */

$('image').onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
        const img = new Image();
        img.onload = function() {
            const tmp = document.createElement('canvas');
            tmp.width = size;
            tmp.height = size;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(img, 0, 0);
            const data = tctx.getImageData(0, 0, size, size).data;
            let p = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] !== 0) {
                    colordata[Math.floor(p / size)][p % size] = rgbToHex(data[i], data[i + 1], data[i + 2], data[i + 3]);
                };
                p ++;
            };
            redraw();
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
    this.value = ''; // lets the same file be imported again
};

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
};
  
function rgbToHex(r, g, b, a = 255) {
    const alpha_append = (a === 255 ? '' : componentToHex(a));
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b) + alpha_append;
};

$('generate').onclick = generateOutput;
