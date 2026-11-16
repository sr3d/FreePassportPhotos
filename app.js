(() => {
  'use strict';

  // ---- Constants -----------------------------------------------------------
  const DPI = 300;
  const MM = DPI / 25.4;                // px per mm at 300 DPI
  const SHEET_LONG = 6 * DPI, SHEET_SHORT = 4 * DPI;   // 4x6 in print = 1800 x 1200 px
  const MARGIN_GAP = 36;                // ~3 mm minimum gap for the "with margins" layout
  const MAX_SOURCE = 3000;              // cap source long side (memory / iOS canvas limits)
  const ZOOM_MIN = 0.5, ZOOM_MAX = 4;

  // Photo types. Guide numbers are in mm measured from the top of the photo.
  //   headCenter: vertical centre of the head ovals; headMin/headMax: chin-to-crown height.
  //   eyeBand: optional [top, bottom] range for the eye line.
  const PRESETS = {
    us: {
      label: 'U.S. passport — 2 × 2 in',
      short: '2×2 in',
      slug: 'us-2x2in',
      wMm: 50.8, hMm: 50.8,
      guide: { headCenter: 19.05, headMin: 25.4, headMax: 34.925, eyeBand: [15.875, 22.225] },
      hint: 'Drag to move · scroll, pinch or use the slider to zoom. Put the top of your head and your chin between the two ovals and your eyes inside the green band.',
      foot: 'U.S. guides: 2×2 in, head 1–1⅜ in from chin to top of head, eyes 1⅛–1⅜ in from the bottom. Check travel.state.gov before printing.',
    },
    vn: {
      label: 'Vietnam passport — 4 × 6 cm',
      short: '4×6 cm',
      slug: 'vietnam-4x6cm',
      wMm: 40, hMm: 60,
      guide: { headCenter: 24, headMin: 32, headMax: 36 },
      hint: 'Drag to move · scroll, pinch or use the slider to zoom. Put the top of your head and your chin between the two ovals. Use a plain white background, face straight on, no glasses.',
      foot: 'Vietnam: 4×6 cm, plain white background, face straight on, no glasses, taken within 6 months. Head-size ovals (≈3.2–3.6 cm) are a common convention, not an official rule — check with the issuing office before printing.',
    },
  };

  // ---- Elements ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone'), fileInput = $('file'), notice = $('notice');
  const editor = $('editor'), frame = $('frame'), frameWrap = $('frameWrap'), sheetPreview = $('sheetPreview');
  const showGuides = $('showGuides'), presetSel = $('preset'), copiesSel = $('copies');
  const layoutFieldset = document.querySelector('.layout'), layoutOptions = $('layoutOptions');
  const sliders = ['zoom', 'rotate', 'brightness', 'contrast', 'saturation', 'warmth']
    .reduce((o, k) => (o[k] = $(k), o), {});

  // ---- State ---------------------------------------------------------------
  // Framing is stored in source-image pixels so the on-screen preview and the
  // exported tile come from exactly the same numbers, whatever size they render at.
  let src = null;                       // canvas holding the (downscaled) source image
  let preset = PRESETS.us;
  let tileW = 600, tileH = 600;         // exported photo size in px
  let layouts = [];                     // sheet layouts available for this photo size
  const view = { cx: 0, cy: 0, zoom: 1, rotate: 0 };
  const adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---- Sheet layouts -------------------------------------------------------
  // Fit as many tiles as possible on the 4x6 sheet, trying both orientations.
  function bestGrid(gap) {
    let best = null;
    for (const [W, H] of [[SHEET_LONG, SHEET_SHORT], [SHEET_SHORT, SHEET_LONG]]) {
      const cols = Math.floor((W - gap) / (tileW + gap));
      const rows = Math.floor((H - gap) / (tileH + gap));
      if (cols < 1 || rows < 1) continue;
      if (!best || cols * rows > best.cols * best.rows) best = { W, H, cols, rows, gap };
    }
    return best;
  }

  function placeTiles(g) {
    const pos = [];
    if (g.gap === 0) {                  // edge to edge, centred
      const x0 = (g.W - g.cols * tileW) / 2, y0 = (g.H - g.rows * tileH) / 2;
      for (let r = 0; r < g.rows; r++)
        for (let c = 0; c < g.cols; c++) pos.push([x0 + c * tileW, y0 + r * tileH]);
    } else {                            // spread leftover space evenly as margins
      const gx = (g.W - g.cols * tileW) / (g.cols + 1), gy = (g.H - g.rows * tileH) / (g.rows + 1);
      for (let r = 0; r < g.rows; r++)
        for (let c = 0; c < g.cols; c++) pos.push([gx + c * (tileW + gx), gy + r * (tileH + gy)]);
      g.minGap = Math.min(gx, gy);
    }
    g.pos = pos;
    return g;
  }

  function computeLayouts() {
    const tight = bestGrid(0), spaced = bestGrid(MARGIN_GAP);
    const out = [];
    if (tight && (!spaced || tight.cols * tight.rows > spaced.cols * spaced.rows)) {
      out.push(Object.assign(placeTiles(tight), { label: `${tight.cols * tight.rows} photos, edge to edge` }));
    }
    if (spaced) {
      const n = spaced.cols * spaced.rows;
      out.push(Object.assign(placeTiles(spaced), {
        label: out.length ? `${n} photos with margins (safer if the lab trims edges)` : `${n} photos with cut marks`,
      }));
    }
    return out;
  }

  // ---- Presets -------------------------------------------------------------
  Object.entries(PRESETS).forEach(([id, p]) => presetSel.add(new Option(p.label, id)));

  function applyPreset(id) {
    preset = PRESETS[id] || PRESETS.us;
    presetSel.value = Object.keys(PRESETS).find((k) => PRESETS[k] === preset);
    store.set('preset', presetSel.value);
    tileW = Math.round(preset.wMm * MM);
    tileH = Math.round(preset.hMm * MM);
    layouts = computeLayouts();

    const aspect = tileW / tileH;
    frame.style.setProperty('--frame-aspect', `${tileW} / ${tileH}`);
    frameWrap.style.maxWidth = `${Math.round(480 * Math.min(1, aspect * 1.25))}px`;
    $('frameHint').textContent = preset.hint;
    $('footNote').textContent = preset.foot;
    $('downloadSingle').textContent = `Single ${preset.short} (JPG)`;

    layoutOptions.innerHTML = '';
    layouts.forEach((l, i) => {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="radio" name="layout" value="${i}"${i === 0 ? ' checked' : ''}> `;
      lab.append(l.label);
      lab.firstChild.addEventListener('change', onLayoutChange);
      layoutOptions.append(lab);
    });
    layoutFieldset.hidden = layouts.length < 2;
    onLayoutChange();

    if (src) resetFraming();
    requestRender();
  }

  function currentLayout() {
    const r = document.querySelector('input[name="layout"]:checked');
    return layouts[r ? +r.value : 0];
  }

  // How many photos to place on the sheet (remembered per photo type).
  function copies() {
    return Math.min(currentLayout().pos.length, Math.max(1, +copiesSel.value || 1));
  }

  function onLayoutChange() {
    const l = currentLayout();
    const max = l.pos.length;
    const wanted = +(store.get('copies-' + preset.slug) || max);
    copiesSel.innerHTML = '';
    for (let n = 1; n <= max; n++) copiesSel.add(new Option(String(n), String(n)));
    copiesSel.value = String(Math.min(max, Math.max(1, wanted)));
    updateOutputInfo();
  }

  function updateOutputInfo() {
    const l = currentLayout();
    const portrait = l.H > l.W;
    sheetPreview.style.setProperty('--sheet-aspect', `${l.W} / ${l.H}`);
    sheetPreview.classList.toggle('portrait', portrait);
    $('outputInfo').textContent =
      `${copies()} of ${l.pos.length} photo${l.pos.length > 1 ? 's' : ''} (${preset.short}) on a ${portrait ? 'portrait' : 'landscape'} 4×6 sheet, ${l.W}×${l.H} px at 300 DPI.`;
    requestRender();
  }

  copiesSel.addEventListener('change', () => {
    store.set('copies-' + preset.slug, copiesSel.value);
    updateOutputInfo();
  });

  presetSel.addEventListener('change', () => applyPreset(presetSel.value));

  // ---- Loading -------------------------------------------------------------
  function showNotice(msg, isError = false) {
    notice.textContent = msg;
    notice.classList.toggle('error', isError);
    notice.hidden = !msg;
  }

  // Decode with the browser's own decoder (applies EXIF orientation).
  async function decodeNative(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // HEIC/HEIF files start with an ISO-BMFF 'ftyp' box naming a HEIF brand.
  async function looksLikeHeic(file) {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
    const head = new TextDecoder('ascii').decode(await file.slice(4, 12).arrayBuffer());
    return head.startsWith('ftyp') && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(head.slice(4).trim());
  }

  // Fallback for browsers without HEIC support (Chrome, Firefox): decode in
  // memory with libheif, loaded on first use only. Nothing is uploaded.
  let heicLib = null;
  async function decodeHeic(file) {
    heicLib = heicLib || import('./vendor/heic-to/heic-to.js');
    const { heicTo } = await heicLib;
    return heicTo({ blob: file, type: 'bitmap' });   // libheif applies HEIC rotation/mirroring
  }

  // Copy the decoded image into a (possibly downscaled) canvas used as the source.
  function toSourceCanvas(image, w, h) {
    const s = Math.min(1, MAX_SOURCE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(image, 0, 0, c.width, c.height);
    return c;
  }

  let loadSeq = 0;
  async function loadFile(file) {
    if (!file) return;
    const seq = ++loadSeq;
    showNotice('');
    let canvas = null;
    try {
      const img = await decodeNative(file);
      canvas = toSourceCanvas(img, img.naturalWidth, img.naturalHeight);
    } catch {
      if (await looksLikeHeic(file)) {
        showNotice('Converting HEIC photo… (this happens on your device and can take a few seconds)');
        try {
          const bmp = await decodeHeic(file);
          canvas = toSourceCanvas(bmp, bmp.width, bmp.height);
          bmp.close();
        } catch (e) {
          console.error('HEIC decode failed', e);
          if (seq === loadSeq) showNotice('Couldn’t convert this HEIC photo. Try exporting it as JPEG first (on iPhone: Settings → Camera → Formats → Most Compatible).', true);
          return;
        }
      } else {
        if (seq === loadSeq) showNotice('Couldn’t open that file. Please choose a JPEG, PNG, WebP or HEIC photo.', true);
        return;
      }
    }
    if (seq !== loadSeq) return;        // a newer file was chosen meanwhile
    showNotice('');
    src = canvas;
    resetFraming();
    dropzone.hidden = true;
    editor.hidden = false;
    requestRender();
  }

  $('pick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
  $('newPhoto').addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === 'drop' || !e.relatedTarget) dropzone.classList.remove('over');
  }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // ---- Framing math --------------------------------------------------------
  // Size of the frame in source pixels: at zoom 1 it is the largest region of the
  // photo with the frame's aspect ratio.
  function frameInSource() {
    const a = tileW / tileH;
    let fw, fh;
    if (src.width / src.height > a) { fh = src.height; fw = fh * a; }
    else { fw = src.width; fh = fw / a; }
    return [fw / view.zoom, fh / view.zoom];
  }

  function resetFraming() {
    view.cx = src.width / 2;
    view.cy = src.height / 2;
    view.zoom = 1;
    view.rotate = 0;
    clampView();
    syncSliders();
  }

  // Keep the image covering the frame when it can; when zoomed out further than
  // that, keep the whole image inside the frame instead (the rest is white).
  function clampView() {
    view.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom));
    const [fw, fh] = frameInSource();
    const clampAxis = (v, len, half) => {
      const lo = Math.min(half, len - half), hi = Math.max(half, len - half);
      return Math.min(hi, Math.max(lo, v));
    };
    view.cx = clampAxis(view.cx, src.width, fw / 2);
    view.cy = clampAxis(view.cy, src.height, fh / 2);
  }

  // Draw the framed photo, with adjustments, into a w x h canvas.
  // Used for both the live preview and the export so they always match.
  function renderTile(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    const k = w / frameInSource()[0];              // output px per source px
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);
    ctx.rotate((view.rotate * Math.PI) / 180);
    ctx.scale(k, k);
    ctx.drawImage(src, -view.cx, -view.cy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    applyAdjustments(ctx, w, h);
    return c;
  }

  // Pixel math rather than ctx.filter, which isn't supported in every browser.
  function applyAdjustments(ctx, w, h) {
    const { brightness, contrast, saturation, warmth } = adjust;
    if (!brightness && !contrast && !saturation && !warmth) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const b = brightness * 0.8;
    const C = contrast * 1.5;
    const cf = (259 * (C + 255)) / (255 * (259 - C));
    const sf = 1 + saturation / 100;
    const wr = warmth * 0.25, wb = -warmth * 0.25;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], bl = d[i + 2];
      r += b; g += b; bl += b;
      r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; bl = cf * (bl - 128) + 128;
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * sf; g = l + (g - l) * sf; bl = l + (bl - l) * sf;
      d[i] = r + wr; d[i + 1] = g; d[i + 2] = bl + wb;   // Uint8ClampedArray clamps
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- Guides --------------------------------------------------------------
  function drawGuides(ctx, w, h) {
    const g = preset.guide;
    const s = h / preset.hMm;           // canvas px per mm
    ctx.save();
    ctx.lineWidth = Math.max(1, w / 300);

    if (g.eyeBand) {
      const [t, b] = g.eyeBand.map((mm) => mm * s);
      ctx.fillStyle = 'rgba(30, 180, 90, 0.16)';
      ctx.fillRect(0, t, w, b - t);
      ctx.strokeStyle = 'rgba(30, 160, 80, 0.9)';
      ctx.setLineDash([w / 60, w / 90]);
      [t, b].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
    }

    // Top of head and chin should fall between these two ovals.
    ctx.strokeStyle = 'rgba(36, 99, 235, 0.95)';
    ctx.setLineDash([]);
    [g.headMin, g.headMax].forEach((mm) => {
      const ry = (mm * s) / 2, rx = ry * 0.74;
      ctx.beginPath();
      ctx.ellipse(w / 2, g.headCenter * s, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(36, 99, 235, 0.35)';
    ctx.setLineDash([w / 80, w / 80]);
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.restore();
  }

  // ---- Sheet composition ---------------------------------------------------
  // Draws the sheet for layout l at scale s (1 = full 300 DPI output).
  function drawSheet(ctx, tile, l, s) {
    const W = l.W * s, H = l.H * s, tw = tileW * s, th = tileH * s;
    const pos = l.pos.slice(0, copies());
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    pos.forEach(([x, y]) => ctx.drawImage(tile, x * s, y * s, tw, th));

    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.beginPath();
    if (l.gap === 0) {
      // Cut lines along every tile edge.
      pos.forEach(([x, y]) => ctx.rect(x * s, y * s, tw, th));
    } else {
      // Corner crop marks in the margins, short enough not to meet between tiles.
      const off = 12 * s, len = Math.max(10, Math.min(60, l.minGap / 2 - 16)) * s;
      pos.forEach(([x, y]) => {
        const X = x * s, Y = y * s;
        [[X, Y, -1, -1], [X + tw, Y, 1, -1], [X, Y + th, -1, 1], [X + tw, Y + th, 1, 1]].forEach(([cx, cy, dx, dy]) => {
          ctx.moveTo(cx + dx * off, cy); ctx.lineTo(cx + dx * (off + len), cy);
          ctx.moveTo(cx, cy + dy * off); ctx.lineTo(cx, cy + dy * (off + len));
        });
      });
    }
    ctx.stroke();
  }

  // ---- Rendering loop ------------------------------------------------------
  let pending = false;
  function requestRender() {
    if (pending || !src) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function fitCanvas(canvas, aspect) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round((rect.width / aspect) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
  }

  function render() {
    // Framing preview: render the tile at the canvas's real pixel size.
    const [fw, fh] = fitCanvas(frame, tileW / tileH);
    const cap = Math.min(1, 1200 / Math.max(fw, fh));
    const tile = renderTile(Math.round(fw * cap), Math.round(fh * cap));
    const fctx = frame.getContext('2d');
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(tile, 0, 0, fw, fh);
    if (showGuides.checked) drawGuides(fctx, fw, fh);

    // Sheet preview.
    const l = currentLayout();
    const [sw] = fitCanvas(sheetPreview, l.W / l.H);
    drawSheet(sheetPreview.getContext('2d'), tile, l, sw / l.W);
  }

  window.addEventListener('resize', requestRender);
  showGuides.addEventListener('change', requestRender);

  // ---- Controls ------------------------------------------------------------
  const fmt = {
    zoom: (v) => `${Math.round(v * 100)}%`,
    rotate: (v) => `${(+v).toFixed(1)}°`,
  };
  const fmtDefault = (v) => (v > 0 ? `+${v}` : `${v}`);

  function syncSliders() {
    sliders.zoom.value = view.zoom;
    sliders.rotate.value = view.rotate;
    Object.keys(adjust).forEach((k) => (sliders[k].value = adjust[k]));
    Object.keys(sliders).forEach((k) => {
      $(k + 'Out').textContent = (fmt[k] || fmtDefault)(+sliders[k].value);
    });
  }

  Object.entries(sliders).forEach(([k, el]) => {
    el.addEventListener('input', () => {
      const v = +el.value;
      if (k === 'zoom') { view.zoom = v; clampView(); }
      else if (k === 'rotate') view.rotate = v;
      else adjust[k] = v;
      syncSliders();
      requestRender();
    });
  });

  $('resetAdjust').addEventListener('click', () => {
    Object.keys(adjust).forEach((k) => (adjust[k] = 0));
    syncSliders();
    requestRender();
  });
  $('resetFrame').addEventListener('click', () => { resetFraming(); requestRender(); });

  // ---- Drag / pinch / wheel on the frame -----------------------------------
  const pointers = new Map();
  let pinchStart = null;

  // Convert a movement in CSS px on the frame to a movement in source px.
  function panBy(dx, dy) {
    const perCss = frameInSource()[0] / frame.getBoundingClientRect().width;
    const a = (-view.rotate * Math.PI) / 180;
    view.cx -= (dx * Math.cos(a) - dy * Math.sin(a)) * perCss;
    view.cy -= (dx * Math.sin(a) + dy * Math.cos(a)) * perCss;
    clampView();
    requestRender();
  }

  function setZoom(z) {
    view.zoom = z;
    clampView();
    syncSliders();
    requestRender();
  }

  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  frame.addEventListener('pointerdown', (e) => {
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    frame.classList.add('dragging');
    if (pointers.size === 2) pinchStart = { d: dist(), zoom: view.zoom };
  });

  frame.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) panBy(dx, dy);
    else if (pointers.size === 2 && pinchStart) setZoom(pinchStart.zoom * (dist() / pinchStart.d));
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (!pointers.size) frame.classList.remove('dragging');
  };
  frame.addEventListener('pointerup', endPointer);
  frame.addEventListener('pointercancel', endPointer);

  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(view.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---- Download ------------------------------------------------------------
  // Canvas JPEGs carry no print resolution; write 300 DPI into the JFIF header
  // so print dialogs default to the right physical size.
  async function jpegWithDpi(canvas) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const isJfif = buf[2] === 0xff && buf[3] === 0xe0 &&
      String.fromCharCode(buf[6], buf[7], buf[8], buf[9]) === 'JFIF';
    if (isJfif) {
      buf[13] = 1;                                  // units: dots per inch
      buf[14] = DPI >> 8; buf[15] = DPI & 0xff;     // X density
      buf[16] = DPI >> 8; buf[17] = DPI & 0xff;     // Y density
    }
    return new Blob([buf], { type: 'image/jpeg' });
  }

  async function save(canvas, name) {
    const blob = await jpegWithDpi(canvas);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('download').addEventListener('click', () => {
    const l = currentLayout();
    const sheet = document.createElement('canvas');
    sheet.width = l.W;
    sheet.height = l.H;
    drawSheet(sheet.getContext('2d'), renderTile(tileW, tileH), l, 1);
    save(sheet, `passport-photos-${preset.slug}-on-4x6in.jpg`);
  });

  $('downloadSingle').addEventListener('click', () => save(renderTile(tileW, tileH), `passport-photo-${preset.slug}.jpg`));

  // ---- Start ---------------------------------------------------------------
  applyPreset(store.get('preset') || 'us');

  // Expose a tiny hook for automated checks.
  window.__passport = { view, adjust, renderTile, applyPreset, get src() { return src; }, get layouts() { return layouts; }, get tile() { return [tileW, tileH]; } };
})();
