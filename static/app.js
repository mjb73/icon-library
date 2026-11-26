"use strict";
/* Icon Library — search + compose front end.
   Stage is rendered at 1024² internally, displayed at 200 px. */

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const ctx = stage.getContext("2d");
const wheel = $("wheel");
const wctx = wheel.getContext("2d");
const WHEEL_PX = wheel.width;

const LS_KEY = "iconLibrary.v1";

/* Text overlay defaults — kept in one object so "+ New design" can hand the
   label back exactly as the composer starts up. */
const TEXT_DEFAULT = { value: "", size: 0.30, x: 0.5, y: 0.5, rot: 0, font: "dejavu-sans", bold: true, colour: "#ffffff" };

const S = {
  bg: "#1e6f8c",
  transparent: false,
  hue: 193, sat: 0.78, val: 0.90,
  /* fg / autoFg are accessors onto the ACTIVE layer's own ink (see
     Object.defineProperties below) — each glyph in a composite can be painted
     in its own colour. */
  gray: false,
  shape: "squircle",
  /* Layers: one glyph each, painted in array order (last one on top).
     size = fraction of the 1024 canvas, x/y = the glyph's centre as a fraction
     of the canvas (0.5 = middle, so it is "where it sits in the frame"), rot =
     degrees about that glyph's own centre, ink = this glyph's own colour (null
     means auto: follow the background). `src` caches the parsed+painted SVG
     so compositeSvg() rebuilds exactly the geometry the canvas drew. */
  layers: [],
  active: 0,
  /* Labels: numbers/letters drawn over the glyphs, painted in array order (last
     one on top). Each is {value, size, x, y, rot, font, bold, colour}. An empty
     `value` draws nothing — the text box is that label's on/off, so nothing else
     can drift from it. `text` is an accessor onto the ACTIVE label (see
     Object.defineProperties below), so every control and export path that means
     "the label I am editing" works unchanged with several labels on the stage. */
  labels: [{ ...TEXT_DEFAULT }],
  activeLabel: 0,
  /* The record in the saved-design library this stage is filed under. Empty
     until the first autosave after a glyph is picked. */
  designId: null,
  designName: "",
  designs: [],
  lastSrc: null,
  results: [],
  query: "",
  offset: 0,
  total: 0,
  sets: new Set(),
  remoteCount: 0,
};

let layerSeq = 0;
function makeLayer(icon, over) {
  return Object.assign(
    { id: "L" + (++layerSeq), icon: icon || null, size: 0.56, x: 0.5, y: 0.5, rot: 0,
      ink: null, src: null },
    over || {},
  );
}
const activeLayer = () => S.layers[S.active] || null;

/* The colour a layer's glyph is painted in. `ink` null = auto: the higher
   contrast of white / #0b1017 on the current background, exactly what the
   single-colour app used to do for every glyph. */
function layerInk(l) {
  const own = l && hexToRgb(l.ink);
  return own ? rgbToHex(...own) : bestInk(S.bg);
}

/* S.icon / S.inset / S.rotation are views onto the ACTIVE layer, kept so every
   existing path — render(), compositeSvg(), the export payload, the launcher
   colour recipe, and any script that pokes S directly — still means "the glyph
   being edited" without knowing layers exist. S.fg / S.autoFg are the same
   trick for ink: one control, the layer it belongs to. */
Object.defineProperties(S, {
  icon: {
    get: () => (activeLayer() ? activeLayer().icon : null),
    set: (v) => {
      if (!activeLayer()) { S.layers.push(makeLayer(v)); S.active = S.layers.length - 1; }
      else activeLayer().icon = v;
    },
  },
  inset: {
    get: () => (activeLayer() ? activeLayer().size : 0.56),
    set: (v) => { if (activeLayer()) activeLayer().size = Number(v) || 0.56; },
  },
  rotation: {
    get: () => (activeLayer() ? activeLayer().rot : 0),
    set: (v) => { if (activeLayer()) activeLayer().rot = Number(v) || 0; },
  },
  fg: {
    get: () => layerInk(activeLayer()),
    set: (v) => {
      const rgb = hexToRgb(v);
      if (!rgb) return;
      if (!activeLayer()) { S.layers.push(makeLayer(null)); S.active = S.layers.length - 1; }
      activeLayer().ink = rgbToHex(...rgb);
    },
  },
  autoFg: {
    get: () => !(activeLayer() && activeLayer().ink),
    set: (on) => {
      if (!activeLayer()) return;
      // on: hand the colour back to the background read-out. off: freeze what
      // is on screen so the next background change does not repaint it.
      activeLayer().ink = on ? null : layerInk(activeLayer());
    },
  },
  /* The label being edited. Get never returns undefined (that would make every
     control read a phantom label), and set replaces the whole active label so
     `S.text = {...TEXT_DEFAULT}` still means "reset this label". */
  text: {
    get: () => {
      if (!Array.isArray(S.labels) || !S.labels.length) {
        S.labels = [{ ...TEXT_DEFAULT }];
        S.activeLabel = 0;
      }
      if (!S.labels[S.activeLabel]) S.activeLabel = 0;
      return S.labels[S.activeLabel];
    },
    set: (v) => {
      const next = Object.assign({ ...TEXT_DEFAULT }, v || {});
      if (!Array.isArray(S.labels) || !S.labels.length) {
        S.labels = [next];
        S.activeLabel = 0;
      } else {
        if (!S.labels[S.activeLabel]) S.activeLabel = 0;
        S.labels[S.activeLabel] = next;
      }
    },
  },
});
S.layers.push(makeLayer(null));

/* ---------------- colour maths ---------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function hexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  const f = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return "#" + f(r) + f(g) + f(b);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

function hsvToRgb(h, s, v) {
  const c = v * s, hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function relLuminance(rgb) {
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function bestInk(bgHex) {
  const bg = hexToRgb(bgHex) || [0, 0, 0];
  const white = [255, 255, 255], ink = [11, 16, 23];
  return contrastRatio(bg, white) >= contrastRatio(bg, ink) ? "#ffffff" : "#0b1017";
}

/* ---------------- background shapes ---------------- */
function shapePoints(shape, size) {
  const c = size / 2;
  const n = shape === "circle" ? 2 : 4;      // superellipse exponent
  const e = 2 / n;
  const pts = [];
  const steps = 256;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push([
      c + c * Math.sign(ct) * Math.pow(Math.abs(ct), e),
      c + c * Math.sign(st) * Math.pow(Math.abs(st), e),
    ]);
  }
  return pts;
}

function drawBackground(g, shape, size, colour) {
  g.save();
  g.fillStyle = colour;
  if (shape === "square" || shape === "full") {
    const r = shape === "square" ? size * 0.1 : 0;
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, size, size, r);
    else g.rect(0, 0, size, size);
    g.fill();
  } else {
    const pts = shapePoints(shape, size);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function bgSvg(shape, size, colour) {
  if (shape === "square" || shape === "full") {
    const r = shape === "square" ? size * 0.1 : 0;
    return `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="${colour}"/>`;
  }
  const d = shapePoints(shape, size)
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
  return `<path d="${d} Z" fill="${colour}"/>`;
}

/* ---------------- label overlay ----------------
   System font stacks only (the same families rsvg/Pango and the browser both
   resolve through fontconfig), so the exported SVG draws the text the same way
   the canvas does — and on any machine that has the family installed. A webfont
   URL would look right in this page and wrong everywhere the export goes; the
   display/script/pixel families are installed locally by sync_fonts.py instead. */
const FONT_STACKS = {
  // sans
  "dejavu-sans": '"DejaVu Sans", Verdana, sans-serif',
  "dejavu-condensed": '"DejaVu Sans Condensed", "DejaVu Sans", sans-serif',
  "liberation-sans": '"Liberation Sans", Arial, sans-serif',
  "noto-sans": '"Noto Sans", "DejaVu Sans", sans-serif',
  "fira-sans": '"Fira Sans", "DejaVu Sans", sans-serif',
  "fira-condensed": '"Fira Sans Condensed", "Fira Sans", sans-serif',
  "open-sans": '"Open Sans", "DejaVu Sans", sans-serif',
  "open-condensed": '"Open Sans Condensed", "Open Sans", sans-serif',
  "cantarell": '"Cantarell", "DejaVu Sans", sans-serif',
  "adwaita-sans": '"Adwaita Sans", "DejaVu Sans", sans-serif',
  // serif
  "dejavu-serif": '"DejaVu Serif", Georgia, serif',
  "dejavu-serif-condensed": '"DejaVu Serif Condensed", "DejaVu Serif", serif',
  "liberation-serif": '"Liberation Serif", "Times New Roman", serif',
  "noto-serif": '"Noto Serif", "DejaVu Serif", serif',
  // mono
  "dejavu-mono": '"DejaVu Sans Mono", "Liberation Mono", monospace',
  "liberation-mono": '"Liberation Mono", monospace',
  "noto-mono": '"Noto Sans Mono", "DejaVu Sans Mono", monospace',
  "adwaita-mono": '"Adwaita Mono", "DejaVu Sans Mono", monospace',
  "hack": '"Hack", "DejaVu Sans Mono", monospace',
  "fantasque": '"FantasqueSansM Nerd Font", "DejaVu Sans Mono", monospace',
  // display (installed by sync_fonts.py)
  "bebas-neue": '"Bebas Neue", "DejaVu Sans", sans-serif',
  "anton": '"Anton", "DejaVu Sans", sans-serif',
  "archivo-black": '"Archivo Black", "DejaVu Sans", sans-serif',
  "alfa-slab": '"Alfa Slab One", "DejaVu Serif", serif',
  "bungee": '"Bungee", "DejaVu Sans", sans-serif',
  "righteous": '"Righteous", "DejaVu Sans", sans-serif',
  "monoton": '"Monoton", "DejaVu Sans", sans-serif',
  "rubik-mono": '"Rubik Mono One", "DejaVu Sans Mono", monospace',
  "orbitron": '"Orbitron", "DejaVu Sans", sans-serif',
  "audiowide": '"Audiowide", "DejaVu Sans", sans-serif',
  "cinzel": '"Cinzel", "DejaVu Serif", serif',
  "playfair": '"Playfair Display", "DejaVu Serif", serif',
  // script
  "pacifico": '"Pacifico", "DejaVu Sans", sans-serif',
  "lobster": '"Lobster", "DejaVu Sans", sans-serif',
  "great-vibes": '"Great Vibes", "DejaVu Serif", serif',
  // retro / comic / pixel
  "bangers": '"Bangers", "DejaVu Sans", sans-serif',
  "creepster": '"Creepster", "DejaVu Sans", sans-serif',
  "press-start-2p": '"Press Start 2P", "DejaVu Sans Mono", monospace',
  "vt323": '"VT323", "DejaVu Sans Mono", monospace',
  "silkscreen": '"Silkscreen", "DejaVu Sans Mono", monospace',
};

const labelStack = (t = S.text) => FONT_STACKS[t.font] || FONT_STACKS["dejavu-sans"];
const FONT_FAMILY = Object.fromEntries(
  Object.entries(FONT_STACKS).map(([id, stack]) => [id, stack.split(",")[0].trim().replace(/^"|"$/g, "")])
);
const labelPx = (t = S.text) => 1024 * t.size;
const labelFontCSS = (t = S.text) => `${t.bold ? "bold " : ""}${labelPx(t)}px ${labelStack(t)}`;

/* Every label that actually draws something, in paint order. */
const visibleLabels = () => (S.labels || []).filter((t) => String(t && t.value || "").trim());

/* Every family is served by /static/fonts/label/label.css, so the same face
   renders — and measures identically — on Linux, macOS and Windows, with no
   system font install. Canvas silently uses a fallback if the face is still
   loading, which would shift the text and the export, so renders wait here. */
const fontLoads = new Map();
function ensureFontLoaded(id = S.text.font, sample = S.text.value) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const fam = FONT_FAMILY[id] || FONT_FAMILY["dejavu-sans"];
  const text = sample || "AaBbCc0123";
  if (!fontLoads.has(id)) {
    fontLoads.set(id, Promise.all([
      document.fonts.load(`400 64px "${fam}"`, text),
      document.fonts.load(`700 64px "${fam}"`, text),
    ]).catch(() => {}));
  }
  return fontLoads.get(id);
}

let measureCtx = null;

/* Geometry for the label, shared by the canvas and the SVG so they cannot drift.
   The text is centred on its ink box: the canvas gives us the ink ascent/descent,
   and the resulting alphabetic baseline is what the SVG <text> is given — both
   then anchor on the baseline, which is the one number Pango and Chrome agree on.
   `rot` turns the text about the anchor point (its own ink centre), so a 90° label
   runs up the middle of the frame instead of sliding off it. */
function labelMetrics(t = S.text) {
  const str = String(t.value || "").trim();
  if (!str) return null;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = labelFontCSS(t);
  const m = measureCtx.measureText(str) || {};
  const asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : labelPx(t) * 0.72;
  const desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : labelPx(t) * 0.2;
  const x = t.x * 1024;
  const y = t.y * 1024;
  /* Baseline offset from the anchor: positive = down, so the ink box straddles y. */
  const dy = (asc - desc) / 2;
  return { str, x, y, dy, baseline: y + dy, rot: labelRot(t), px: labelPx(t), width: m.width || 0, asc, desc };
}

const labelRot = (t = S.text) => {
  const r = Number(t.rot);
  return Number.isFinite(r) ? ((r % 360) + 360) % 360 : 0;
};

function drawLabel(g, t = S.text) {
  const mm = labelMetrics(t);
  if (!mm) return;
  g.save();
  g.translate(mm.x, mm.y);
  if (mm.rot) g.rotate((mm.rot * Math.PI) / 180);
  g.font = labelFontCSS(t);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = t.colour;
  g.fillText(mm.str, 0, mm.dy);
  g.restore();
}

/* Every label, back to front — same order as the SVG, so the two cannot drift. */
function drawLabels(g) {
  (S.labels || []).forEach((t) => drawLabel(g, t));
}

const xmlEsc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function labelSvgOne(t) {
  const mm = labelMetrics(t);
  if (!mm) return "";
  const text = `<text x="0" y="${mm.dy.toFixed(2)}" text-anchor="middle"`
    + ` font-family="${xmlEsc(labelStack(t))}" font-size="${mm.px.toFixed(2)}"`
    + ` font-weight="${t.bold ? 700 : 400}" fill="${t.colour}">`
    + `${xmlEsc(mm.str)}</text>`;
  /* Rotate about the anchor, exactly as the canvas does — same one number, same
     transform order, so the exported SVG cannot drift from the stage. */
  return mm.rot
    ? `<g transform="translate(${mm.x.toFixed(2)} ${mm.y.toFixed(2)}) rotate(${mm.rot.toFixed(2)})">${text}</g>`
    : `<g transform="translate(${mm.x.toFixed(2)} ${mm.y.toFixed(2)})">${text}</g>`;
}

function labelSvg() {
  return (S.labels || []).map(labelSvgOne).filter(Boolean).join("\n");
}

/* ---------------- stage rendering ---------------- */
let renderSeq = 0;

function sanitize(body) {
  return String(body || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/href\s*=\s*("|')javascript:/gi, "href=$1#");
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("svg load failed"));
    img.src = src;
  });
}

async function svgSource(icon, fg) {
  let w = icon.w || 24, h = icon.h || 24, body = icon.body || "";
  if (!body && icon.remote) {
    // Never fetch api.iconify.design from the page: a 429 or a blocked origin
    // made this throw, and the caller silently drew a bare background. Our own
    // backend caches the glyph and turns failures into a readable error.
    const res = await fetch("/api/icon/" + encodeURIComponent(icon.prefix || "") +
                            "/" + encodeURIComponent(icon.name || ""));
    if (!res.ok) {
      let why = res.statusText;
      try { why = (await res.json()).detail || why; } catch (_) {}
      throw new Error(why || ("HTTP " + res.status));
    }
    const txt = await res.text();
    const vb = txt.match(/viewBox="([\d.\-\s]+)"/);
    if (vb) {
      const p = vb[1].trim().split(/\s+/).map(Number);
      if (p.length === 4) { w = p[2] || w; h = p[3] || h; }
    }
    body = txt.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "");
    icon.w = w; icon.h = h; icon.body = body;
  }
  const painted = sanitize(body).replace(/currentColor/g, fg);
  return { w, h, body: painted };
}

function toGray(imgData) {
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  return imgData;
}

/* Rasterise one layer's glyph at its own target size. Returns null when a newer
   render has already superseded this one (stale sequence). */
async function layerRaster(layer, seq) {
  const src = await svgSource(layer.icon, layerInk(layer));
  if (seq !== renderSeq) return null;
  const box = 1024 * layer.size;
  const k = box / Math.max(src.w, src.h);
  const w2 = Math.max(1, Math.round(src.w * k));
  const h2 = Math.max(1, Math.round(src.h * k));

  const off = document.createElement("canvas");
  off.width = w2; off.height = h2;
  const octx = off.getContext("2d");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${src.w} ${src.h}" `
            + `width="${w2}" height="${h2}">${src.body}</svg>`;
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  if (seq !== renderSeq) return null;

  octx.clearRect(0, 0, w2, h2);
  octx.drawImage(img, 0, 0, w2, h2);
  if (S.gray) octx.putImageData(toGray(octx.getImageData(0, 0, w2, h2)), 0, 0);
  return { src, off, w2, h2 };
}

async function render() {
  const seq = ++renderSeq;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 1024, 1024);
  if (!S.transparent) drawBackground(ctx, S.shape, 1024, S.bg);
  if (!S.layers.some((l) => l.icon)) {
    S.layers.forEach((l) => { l.src = null; });
    S.lastSrc = null;
    return;
  }

  for (const layer of S.layers) {
    if (!layer.icon) continue;
    let ras;
    try {
      ras = await layerRaster(layer, seq);
    } catch (e) {
      // A failed glyph used to leave the preview showing only its background,
      // with the reason in the console where nobody looks.
      console.warn(e);
      layer.src = null;
      if (layer === activeLayer()) {
        const meta = document.querySelector(".sel-meta");
        if (meta) meta.textContent = "Couldn't load this glyph — " + e.message;
      }
      continue;
    }
    if (!ras) return;
    layer.src = ras.src;
    ctx.save();
    ctx.translate(layer.x * 1024, layer.y * 1024);
    if (layer.rot) ctx.rotate((layer.rot * Math.PI) / 180);
    ctx.drawImage(ras.off, -ras.w2 / 2, -ras.h2 / 2);
    ctx.restore();
  }
  if (seq !== renderSeq) return;
  const act = activeLayer();
  S.lastSrc = act ? act.src : null;
  /* Wait for every face a label uses, not just the active one — a second label in
     another family would otherwise be measured through a fallback on first paint. */
  await Promise.all(visibleLabels().map((t) => ensureFontLoaded(t.font, t.value)));
  if (seq !== renderSeq) return;
  drawLabels(ctx); // labels sit on top, unrotated: they are separate layers
}

/* ---------------- composite SVG ----------------
   Same chain per layer as the canvas: translate to the glyph's centre in the
   frame, rotate about that centre, then the rounded pixel origin — canvas and
   export cannot drift apart. */
function compositeSvg() {
  const layers = S.layers.filter((l) => l.icon && l.src);
  if (!layers.length) return "";
  const gs = S.gray
    ? `<defs><filter id="gs" x="-20%" y="-20%" width="140%" height="140%">`
      + `<feColorMatrix type="saturate" values="0"/></filter></defs>`
    : "";
  const filter = S.gray ? ' filter="url(#gs)"' : "";
  const glyphs = layers.map((l) => {
    const { w, h, body } = l.src;
    const box = 1024 * l.size;
    const k = box / Math.max(w, h);
    const w2 = Math.max(1, Math.round(w * k));
    const h2 = Math.max(1, Math.round(h * k));
    const cx = (l.x * 1024).toFixed(2), cy = (l.y * 1024).toFixed(2);
    return `<g${filter} transform="translate(${cx},${cy})${l.rot ? ` rotate(${l.rot})` : ""} `
      + `translate(${(-w2 / 2).toFixed(2)},${(-h2 / 2).toFixed(2)}) `
      + `scale(${(w2 / w).toFixed(6)},${(h2 / h).toFixed(6)})">\n${body}\n</g>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${gs}${S.transparent ? "" : bgSvg(S.shape, 1024, S.bg)}
${glyphs}
${labelSvg()}
</svg>`;
}

/* ---------------- colour wheel ---------------- */
function drawWheel() {
  const R = WHEEL_PX / 2 - 2;
  const c = WHEEL_PX / 2;
  const img = wctx.createImageData(WHEEL_PX, WHEEL_PX);
  const d = img.data;
  for (let y = 0; y < WHEEL_PX; y++) {
    for (let x = 0; x < WHEEL_PX; x++) {
      const dx = x - c, dy = y - c;
      const r = Math.hypot(dx, dy);
      const i = (y * WHEEL_PX + x) * 4;
      if (r > R) { d[i + 3] = 0; continue; }
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const sat = clamp(r / R, 0, 1);
      const [rr, gg, bb] = hsvToRgb(hue, sat, S.val);
      d[i] = rr; d[i + 1] = gg; d[i + 2] = bb;
      d[i + 3] = r > R - 1.5 ? Math.round(255 * (R - r) / 1.5) : 255;
    }
  }
  wctx.putImageData(img, 0, 0);

  // marker
  const a = ((S.hue - 90) * Math.PI) / 180;
  const mr = S.sat * R;
  const mx = c + Math.cos(a) * mr, my = c + Math.sin(a) * mr;
  wctx.beginPath();
  wctx.arc(mx, my, 8, 0, Math.PI * 2);
  wctx.lineWidth = 3;
  wctx.strokeStyle = "rgba(0,0,0,0.65)";
  wctx.stroke();
  wctx.beginPath();
  wctx.arc(mx, my, 6, 0, Math.PI * 2);
  wctx.strokeStyle = "#fff";
  wctx.lineWidth = 2;
  wctx.stroke();
}

function wheelPick(ev) {
  const rect = wheel.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (WHEEL_PX / rect.width);
  const y = (ev.clientY - rect.top) * (WHEEL_PX / rect.height);
  const c = WHEEL_PX / 2;
  const R = WHEEL_PX / 2 - 2;
  const dx = x - c, dy = y - c;
  const sat = clamp(Math.hypot(dx, dy) / R, 0, 1);
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  S.hue = hue; S.sat = sat;
  const [r, g, b] = hsvToRgb(hue, sat, S.val);
  applyBg(rgbToHex(r, g, b), false);
  drawWheel();
}

let wheelDown = false;
wheel.addEventListener("pointerdown", (e) => { wheelDown = true; wheel.setPointerCapture(e.pointerId); wheelPick(e); });
wheel.addEventListener("pointermove", (e) => { if (wheelDown) wheelPick(e); });
wheel.addEventListener("pointerup", () => { wheelDown = false; noteRecent(S.bg); });

/* ---------------- recent colours + colour picker ----------------

   Two things the user asked for, in one place: the last five colours they
   actually settled on (shared by background and icon colour, newest first,
   persisted) and an in-page picker — saturation/brightness square, hue slider,
   two-way hex — opened by tapping the swatch next to either hex field. The
   native OS colour dialog is gone: it speaks RGB, ignores the app's look and
   cannot show a hue ramp.

   A colour is only filed as "used" when the pick is finished (pointer up,
   change, picker close), never on every frame of a drag, or the recents would
   fill with the intermediate colours of one wheel sweep. */

const RECENT_KEY = "iconLibrary.recentColours";
const RECENT_MAX = 5;

function loadRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (Array.isArray(raw)) return raw.filter((h) => hexToRgb(h)).slice(0, RECENT_MAX);
  } catch (e) { /* a broken value must not stop the app booting */ }
  return [];
}
let recentColours = loadRecent();

function paintSwatch(id, hex) {
  const el = $(id);
  if (el) el.style.background = hex;
}

/* Icon colour writes the ACTIVE layer's ink — the same path the hex field and the
   auto switch take, so a composite can still paint each glyph differently. */
function setInk(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  S.fg = rgbToHex(...rgb);
  syncFgUI(); paintLayers(); render(); save();
}

function paintRecent() {
  for (const [id, target] of [["bgRecent", "bg"], ["fgRecent", "fg"]]) {
    const row = $(id);
    if (!row) continue;
    row.textContent = "";
    for (const hex of recentColours) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "recent-chip";
      b.dataset.hex = hex.toLowerCase();
      b.style.background = hex;
      b.title = hex.toUpperCase();
      b.setAttribute("aria-label", "Use " + hex.toUpperCase());
      b.addEventListener("click", () => {
        if (target === "bg") { applyBg(hex); drawWheel(); }
        else setInk(hex);
        noteRecent(hex);
      });
      row.appendChild(b);
    }
  }
  markRecent();
}

/* Which chip is the current value — a two-line class toggle, cheap enough to run
   from applyBg, which fires on every frame of a wheel drag. */
function markRecent() {
  const bg = (S.bg || "").toLowerCase();
  const ink = (S.fg || "").toLowerCase();
  document.querySelectorAll("#bgRecent .recent-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.hex === bg);
  });
  document.querySelectorAll("#fgRecent .recent-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.hex === ink);
  });
}

function noteRecent(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const norm = rgbToHex(...rgb);
  if (recentColours.length && recentColours[0].toLowerCase() === norm.toLowerCase()) return;
  recentColours = [norm, ...recentColours.filter((h) => h.toLowerCase() !== norm.toLowerCase())]
    .slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentColours)); } catch (e) { /* quota */ }
  paintRecent();
}

const pickerEl = $("picker");
const pickSv = $("pickSv");
const pickCtx = pickSv.getContext("2d");
const pick = { target: null, h: 200, s: 0.7, v: 0.9, anchor: null };

function pickColour() {
  const [r, g, b] = hsvToRgb(pick.h, pick.s, pick.v);
  return rgbToHex(r, g, b);
}

function paintSv() {
  const w = pickSv.width, hgt = pickSv.height;
  const [r, g, b] = hsvToRgb(pick.h, 1, 1);
  pickCtx.fillStyle = rgbToHex(r, g, b);
  pickCtx.fillRect(0, 0, w, hgt);
  const white = pickCtx.createLinearGradient(0, 0, w, 0);
  white.addColorStop(0, "#fff");
  white.addColorStop(1, "rgba(255,255,255,0)");
  pickCtx.fillStyle = white;
  pickCtx.fillRect(0, 0, w, hgt);
  const black = pickCtx.createLinearGradient(0, 0, 0, hgt);
  black.addColorStop(0, "rgba(0,0,0,0)");
  black.addColorStop(1, "#000");
  pickCtx.fillStyle = black;
  pickCtx.fillRect(0, 0, w, hgt);
  const mx = pick.s * w, my = (1 - pick.v) * hgt;
  pickCtx.beginPath();
  pickCtx.arc(mx, my, 7, 0, Math.PI * 2);
  pickCtx.lineWidth = 3;
  pickCtx.strokeStyle = "rgba(0,0,0,0.55)";
  pickCtx.stroke();
  pickCtx.beginPath();
  pickCtx.arc(mx, my, 5.5, 0, Math.PI * 2);
  pickCtx.strokeStyle = "#fff";
  pickCtx.lineWidth = 1.5;
  pickCtx.stroke();
}

function pickApply() {
  const hex = pickColour();
  $("pickHex").value = hex.toUpperCase();
  $("pickPreview").style.background = hex;
  if (pick.target === "bg") { applyBg(hex); drawWheel(); }
  else if (pick.target === "fg") setInk(hex);
}

function openPicker(target, anchor) {
  const cur = hexToRgb(target === "bg" ? S.bg : S.fg) || [30, 111, 140];
  const [h, s, v] = rgbToHsv(...cur);
  pick.target = target;
  pick.anchor = anchor;
  pick.h = h; pick.s = s; pick.v = v;
  $("pickHue").value = Math.round(h);
  $("pickHex").value = rgbToHex(...cur).toUpperCase();
  $("pickPreview").style.background = rgbToHex(...cur);
  paintSv();
  pickerEl.classList.remove("hidden");   // measure after it is laid out
  const r = anchor.getBoundingClientRect();
  const pw = pickerEl.offsetWidth, ph = pickerEl.offsetHeight;
  let left = Math.min(r.right - pw, window.innerWidth - pw - 8);
  left = Math.max(8, left);
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  pickerEl.style.left = left + "px";
  pickerEl.style.top = top + "px";
  anchor.setAttribute("aria-expanded", "true");
}

function closePicker() {
  if (!pickerEl || pickerEl.classList.contains("hidden")) return;
  pickerEl.classList.add("hidden");
  if (pick.anchor) pick.anchor.setAttribute("aria-expanded", "false");
  if (pick.target) noteRecent(pickColour());
  pick.anchor = null;
  pick.target = null;
}

function svPick(ev) {
  const rect = pickSv.getBoundingClientRect();
  pick.s = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
  pick.v = 1 - clamp((ev.clientY - rect.top) / rect.height, 0, 1);
  pickApply();
  paintSv();
}

let svDown = false;
pickSv.addEventListener("pointerdown", (e) => {
  svDown = true;
  pickSv.setPointerCapture(e.pointerId);
  svPick(e);
});
pickSv.addEventListener("pointermove", (e) => { if (svDown) svPick(e); });
pickSv.addEventListener("pointerup", () => { svDown = false; noteRecent(pickColour()); });

$("pickHue").addEventListener("input", (e) => {
  pick.h = Number(e.target.value);
  pickApply();
  paintSv();
});
$("pickHue").addEventListener("change", () => noteRecent(pickColour()));
$("pickHex").addEventListener("change", (e) => {
  const rgb = hexToRgb(e.target.value.trim());
  if (!rgb) { e.target.value = pickColour().toUpperCase(); return; }
  const [h, s, v] = rgbToHsv(...rgb);
  pick.h = h; pick.s = s; pick.v = v;
  $("pickHue").value = Math.round(h);
  pickApply();
  paintSv();
  noteRecent(rgbToHex(...rgb));
});
$("pickDone").addEventListener("click", closePicker);
$("bgSwatch").addEventListener("click", (e) => openPicker("bg", e.currentTarget));
$("fgSwatch").addEventListener("click", (e) => openPicker("fg", e.currentTarget));

/* Screen-wide eyedropper. window.EyeDropper hands the pick to the OS: the
   compositor shows its own magnifier and returns one pixel from ANYWHERE on the
   desktop, other windows and other monitors included. Nothing drawn inside this
   page could do that — a canvas read or a page overlay only ever samples this
   window, which is the behaviour it is meant to replace. Chromium-only and a
   secure context is required, so an unavailable button says why instead of
   failing silently on click. */
const hasEyeDropper = typeof window.EyeDropper === "function";

async function screenPick(target, btn) {
  if (!hasEyeDropper) return;
  try {
    const { sRGBHex } = await new window.EyeDropper().open();
    if (target === "bg") { applyBg(sRGBHex); drawWheel(); }
    else setInk(sRGBHex);
    noteRecent(sRGBHex);
    // keep an open popover in step with what was just sampled
    if (!pickerEl.classList.contains("hidden")) openPicker(target, pick.anchor || btn);
  } catch (e) { /* AbortError: the pick was cancelled, leave the colour alone */ }
}

$("bgPipette").addEventListener("click", (e) => screenPick("bg", e.currentTarget));
$("fgPipette").addEventListener("click", (e) => screenPick("fg", e.currentTarget));
if (!hasEyeDropper) {
  for (const id of ["bgPipette", "fgPipette"]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = true;
    b.title = window.isSecureContext
      ? "Screen picker needs Chrome, Edge or Brave"
      : "Screen picker needs an https:// or 127.0.0.1 page";
  }
}
document.addEventListener("pointerdown", (e) => {
  if (pickerEl.classList.contains("hidden")) return;
  if (pickerEl.contains(e.target)) return;
  if (pick.anchor && pick.anchor.contains(e.target)) return;
  closePicker();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
// position:fixed would otherwise stay put while the tab panel scrolls under it
window.addEventListener("scroll", closePicker, true);
window.addEventListener("resize", closePicker);
paintRecent();

/* ---------------- state -> UI ---------------- */
function applyBg(hex, syncHsv = true) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  S.bg = rgbToHex(...rgb);
  if (syncHsv) {
    const [h, s, v] = rgbToHsv(...rgb);
    S.hue = h; S.sat = s; S.val = v;
    $("val").value = Math.round(v * 100);
  }
  $("hex").value = S.bg.toUpperCase();
  paintSwatch("bgSwatch", S.bg);
  markRecent();
  syncFgUI();       // auto ink is resolved from the background, so re-read it
  syncPresetActive();
  render();
  save();
}

/* One place that writes the icon colour: hex field, swatch, which layer it
   belongs to, and the contrast note. Every value here is the ACTIVE layer's
   ink, so switching layer chips re-reads it. */
function syncFgUI() {
  $("fgHex").value = S.fg.toUpperCase();
  paintSwatch("fgSwatch", S.fg);
  markRecent();
  $("autoFg").checked = S.autoFg;
  const which = $("fgLayer");
  if (which) {
    which.textContent = S.layers.length > 1 ? `layer ${S.active + 1}` : "";
  }
  const all = $("fgAll");
  if (all) all.classList.toggle("hidden", S.layers.filter((x) => x.icon).length < 2);
  updateFgNote();
}

function updateFgNote() {
  if (S.transparent) { $("fgNote").textContent = "no bg"; return; }
  const bg = hexToRgb(S.bg) || [0, 0, 0];
  const fg = hexToRgb(S.fg) || [255, 255, 255];
  $("fgNote").textContent = `${contrastRatio(bg, fg).toFixed(1)}:1`;
}

/* Transparency makes the wheel and the shape selector inert — dim them rather than hide,
   so the layout does not jump and the controls are obviously still there. */
function syncBgControls() {
  $("colourPanel").classList.toggle("dim", S.transparent);
  $("shapeControl").classList.toggle("dim", S.transparent);
  $("bgRecent").classList.toggle("dim", S.transparent); // a recent chip must not look live under `transparent`
}

function selectIcon(r, tileEl) {
  if (!activeLayer()) { S.layers.push(makeLayer(null)); S.active = S.layers.length - 1; }
  // A tile click fills the ACTIVE layer. "+ Icon" adds an empty layer first, so
  // adding a second glyph is: press + Icon, then pick from the grid.
  activeLayer().icon = r;
  activeLayer().src = null;
  document.querySelectorAll(".tile.active").forEach((t) => t.classList.remove("active"));
  if (tileEl) tileEl.classList.add("active");
  syncLayerUI();
  render();
  save();
  if (window.innerWidth <= 860) {
    document.querySelector(".composer").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ---------------- layers ---------------- */
function layerName(l) {
  return l.icon ? `${l.icon.prefix}:${l.icon.name}` : "empty — pick a glyph";
}

function paintLayers() {
  const strip = $("layerStrip");
  if (!strip) return;
  strip.textContent = "";
  S.layers.forEach((l, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "layer-chip" + (i === S.active ? " active" : "") + (l.icon ? "" : " empty");
    chip.title = layerName(l);
    chip.setAttribute("aria-label", "Layer " + (i + 1) + ": " + layerName(l));
    if (l.icon) {
      if (l.icon.body) {
        chip.innerHTML = `<svg viewBox="0 0 ${l.icon.w || 24} ${l.icon.h || 24}" width="20" height="20" `
          + `fill="currentColor">${sanitize(l.icon.body)}</svg>`;
      } else {
        chip.textContent = l.icon.name.slice(0, 2);
      }
      // The chip is the ink swatch for its layer: two glyphs in two colours are
      // only obvious in the strip if the chips show them. Ink as the background
      // (not the glyph) so a near-black ink is never black-on-black.
      const ink = layerInk(l);
      chip.style.background = ink;
      chip.style.color = bestInk(ink);
      chip.title = layerName(l) + " \u00b7 " + ink.toUpperCase();
    } else {
      chip.innerHTML = `<span class="layer-plus">+</span>`;
    }
    chip.addEventListener("click", () => {
      S.active = i;
      syncLayerUI();
      render();
      save();
    });
    strip.appendChild(chip);
  });
  const n = S.layers.length;
  const filled = S.layers.filter((l) => l.icon).length;
  $("layerNote").textContent = filled + "/" + n + " filled";
  $("layerRemove").disabled = n <= 1;
}

function syncLayerUI() {
  const l = activeLayer();
  const has = !!(l && l.icon);
  const pct = (v) => Math.round(v * 100) + "%";

  $("inset").value = Math.round((l ? l.size : 0.56) * 100);
  $("insetLabel").textContent = Math.round((l ? l.size : 0.56) * 100) + "%";
  $("iconX").value = Math.round((l ? l.x : 0.5) * 100);
  $("iconXOut").textContent = pct(l ? l.x : 0.5);
  $("iconY").value = Math.round((l ? l.y : 0.5) * 100);
  $("iconYOut").textContent = pct(l ? l.y : 0.5);
  $("rotation").value = l ? l.rot : 0;
  $("rotationLabel").textContent = (l ? l.rot : 0) + "\u00b0";

  // Geometry only means something once the layer has a glyph.
  ["inset", "iconX", "iconY", "rotation"].forEach((id) => { $(id).disabled = !has; });

  const any = S.layers.some((x) => x.icon);
  ["exportBtn", "pngBtn", "svgBtn", "svgCopyBtn"].forEach((id) => { $(id).disabled = !any; });
  if (LAUNCH_TARGET) $("lbSave").disabled = !any;

  $("selInfo").querySelector(".sel-name").textContent =
    has ? `${l.icon.prefix}:${l.icon.name}` : "No icon selected";
  $("selInfo").querySelector(".sel-meta").textContent = has
    ? `${l.icon.collection || l.icon.prefix}${l.icon.spdx ? " \u00b7 " + l.icon.spdx : ""}` +
      (l.icon.remote ? " \u00b7 live" : "") + (S.layers.length > 1 ? ` \u00b7 layer ${S.active + 1}/${S.layers.length}` : "")
    : "pick one from the grid";
  syncFgUI();       // the ink control belongs to the active layer too
  paintLayers();
}

function addLayer() {
  S.layers.push(makeLayer(null));
  S.active = S.layers.length - 1;
  syncLayerUI();
  render();
  save();
}

function removeLayer() {
  if (S.layers.length <= 1) return;
  S.layers.splice(S.active, 1);
  S.active = clamp(S.active, 0, S.layers.length - 1);
  syncLayerUI();
  render();
  save();
}

/* ---------------- search ---------------- */
const remoteInk = () => getComputedStyle(document.body).color;

async function runSearch(reset = true) {
  const q = $("q").value.trim();
  if (!q) { S.query = ""; S.results = []; S.total = 0; paintGrid(); return; }
  if (reset) { S.offset = 0; S.results = []; }
  const params = new URLSearchParams({ q, limit: "60", offset: String(S.offset) });
  if (S.sets.size) params.set("sets", [...S.sets].join(","));
  $("resultInfo").textContent = "searching…";
  try {
    const res = await fetch("/api/search?" + params.toString());
    const data = await res.json();
    S.total = data.total;
    S.remoteCount = data.live || 0;
    S.results = S.results.concat(data.results);
    $("resultInfo").textContent =
      `${data.total.toLocaleString()} hit${data.total === 1 ? "" : "s"}`
      + (data.local_total ? ` · ${data.local_total.toLocaleString()} local` : "")
      + (data.live ? ` · ${data.live} live` : "");
    paintGrid();
  } catch (e) {
    $("resultInfo").textContent = "search failed — is the server up?";
    console.error(e);
  }
}

function tileFor(r) {
  const el = document.createElement("button");
  el.className = "tile" + (r.remote ? " remote" : "");
  el.type = "button";
  if (r.remote) {
    const ink = encodeURIComponent(remoteInk());
    el.innerHTML = `<img alt="" src="https://api.iconify.design/${r.prefix}/${r.name}.svg?color=${ink}">`;
  } else {
    el.innerHTML = `<svg viewBox="0 0 ${r.w || 24} ${r.h || 24}" width="34" height="34" `
      + `fill="currentColor">${sanitize(r.body)}</svg>`;
  }
  const label = document.createElement("span");
  label.className = "tile-name";
  label.textContent = r.name;
  el.appendChild(label);
  const src = document.createElement("span");
  src.className = "tile-src";
  src.textContent = r.prefix;
  el.appendChild(src);
  el.addEventListener("click", () => selectIcon(r, el));
  return el;
}

function paintGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  S.results.forEach((r) => grid.appendChild(tileFor(r)));
  $("empty").classList.toggle("hidden", S.results.length > 0);
  $("moreWrap").classList.toggle("hidden", !(S.results.length && S.results.length < S.total));
  if (S.icon) {
    const sel = S.results.findIndex((r) => r.id === S.icon.id);
    if (sel >= 0) grid.children[sel].classList.add("active");
  }
}

/* ---------------- export ---------------- */
function slug(text) {
  return (text || "icon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "icon";
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* The glyph that names the export: the layer being edited, else the first one
   with a glyph. */
function primaryIcon() {
  const act = activeLayer();
  if (act && act.icon) return act.icon;
  const first = S.layers.find((l) => l.icon);
  return first ? first.icon : null;
}

async function exportSet() {
  const primary = primaryIcon();
  if (!primary) return;
  const btn = $("exportBtn");
  btn.disabled = true;
  btn.textContent = "Building…";
  try {
    const payload = {
      png: stage.toDataURL("image/png"),
      svg: compositeSvg(),
      name: primary.name,
      icon: primary.id,
      collection: primary.collection,
      license: primary.spdx,
      license_url: primary.license_url || "",
      author: primary.author || "",
      bg: S.transparent ? null : S.bg, fg: S.fg, grayscale: S.gray, shape: S.shape,
      transparent: S.transparent, inset: S.inset, rotation: S.rotation, remote: !!primary.remote,
      label: (S.text.value || "").trim() ? { ...S.text } : null,
      labels: visibleLabels().map((t) => ({ ...t })),
      layers: S.layers.filter((l) => l.icon).map((l) => ({
        icon: l.icon.id, name: l.icon.name, collection: l.icon.collection,
        license: l.icon.spdx, license_url: l.icon.license_url || "",
        author: l.icon.author || "", size: l.size, x: l.x, y: l.y, rotation: l.rot,
        ink: layerInk(l), auto_ink: !l.ink, remote: !!l.icon.remote,
      })),
    };
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    download(await res.blob(), `${slug(primary.name)}-iconset.zip`);
  } catch (e) {
    console.error(e);
    $("exportNote").textContent = "export failed: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Export set";
  }
}

/* ---------------- wiring ---------------- */
$("searchBtn").addEventListener("click", () => runSearch(true));
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(true); });
let debounce;
$("q").addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { if ($("q").value.trim().length >= 2) runSearch(true); }, 220);
});
$("moreBtn").addEventListener("click", () => { S.offset += 60; runSearch(false); });

$("setsToggle").addEventListener("click", () => $("setChips").classList.toggle("collapsed"));

$("hex").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  applyBg(v.startsWith("#") ? v : "#" + v);
  drawWheel();
  noteRecent(S.bg);
});
$("val").addEventListener("input", (e) => {
  S.val = Number(e.target.value) / 100;
  const [r, g, b] = hsvToRgb(S.hue, S.sat, S.val);
  applyBg(rgbToHex(r, g, b), false);
  drawWheel();
});
/* Icon colour is per layer: the hex field, the swatch and the auto switch all
   write the ACTIVE layer's `ink`, so a composite can paint each glyph in its
   own colour. "all layers" copies the active colour onto every glyph. */
$("autoFg").addEventListener("change", (e) => {
  S.autoFg = e.target.checked;
  syncFgUI(); paintLayers(); render(); save();
});
$("fgHex").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  const rgb = hexToRgb(v.startsWith("#") ? v : "#" + v);
  if (!rgb) { $("fgHex").value = S.fg.toUpperCase(); return; }
  setInk(rgbToHex(...rgb));
  noteRecent(S.fg);
});
$("fgAll").addEventListener("click", () => {
  const ink = S.fg;
  S.layers.forEach((l) => { l.ink = ink; });
  syncFgUI(); paintLayers(); render(); save();
});
$("transparent").addEventListener("change", (e) => {
  S.transparent = e.target.checked;
  syncBgControls();
  updateFgNote();
  render(); save();
});
$("gray").addEventListener("change", (e) => {
  S.gray = e.target.checked;
  $("grayState").textContent = S.gray ? "on" : "off";
  render(); save();
});
$("shapeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-shape]");
  if (!b) return;
  S.shape = b.dataset.shape;
  [...$("shapeSeg").children].forEach((x) => x.classList.toggle("active", x === b));
  render(); save();
});
/* Per-layer geometry. Every slider writes the ACTIVE layer only, so a second
   glyph can sit anywhere in the frame at its own size and angle. */
$("inset").addEventListener("input", (e) => {
  if (!activeLayer()) return;
  activeLayer().size = Number(e.target.value) / 100;
  $("insetLabel").textContent = e.target.value + "%";
  render(); save();
});
$("iconX").addEventListener("input", (e) => {
  if (!activeLayer()) return;
  activeLayer().x = Number(e.target.value) / 100;
  $("iconXOut").textContent = e.target.value + "%";
  render(); save();
});
$("iconY").addEventListener("input", (e) => {
  if (!activeLayer()) return;
  activeLayer().y = Number(e.target.value) / 100;
  $("iconYOut").textContent = e.target.value + "%";
  render(); save();
});
$("rotation").addEventListener("input", (e) => {
  if (!activeLayer()) return;
  activeLayer().rot = Number(e.target.value);
  $("rotationLabel").textContent = e.target.value + "\u00b0";
  render(); save();
});
$("layerAdd").addEventListener("click", addLayer);
$("layerRemove").addEventListener("click", removeLayer);

/* Tabs keep the panel short enough that the stage stays on screen while a
   control is being dragged — the composer is capped to the viewport and only
   the open panel scrolls. */
function showTab(name) {
  const tab = $("tabs").querySelector(`button[data-tab="${name}"]`) ? name : "icons";
  [...$("tabs").children].forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tabpanel").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === tab);
  });
  try { localStorage.setItem("iconLibrary.tab", tab); } catch (e) { /* ignore */ }
  syncSticky();
}
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});

/* ---------------- font picker ----------------
   A native <select> cannot be relied on to draw each option in its own face
   (Firefox/GTK opens a system menu; Chromium's popup styling differs by
   platform). The visible control is therefore a listbox rendered from the
   hidden select, which stays the source of truth: syncLabelUI() writes it and
   choosing an item dispatches its `change` event, so the label pipeline is
   unchanged. The list lives on <body> so no scrolling panel can clip it. */
const fontList = document.createElement("ul");
fontList.id = "fontPickerList";
fontList.className = "font-picker-list";
fontList.setAttribute("role", "listbox");
fontList.setAttribute("aria-label", "Label font");
fontList.hidden = true;
document.body.appendChild(fontList);

let fontPickerOpen = false;

function fontItem(opt) {
  const li = document.createElement("li");
  li.className = "font-picker-item";
  li.dataset.value = opt.value;
  li.setAttribute("role", "option");
  li.tabIndex = -1;
  li.textContent = opt.textContent;
  li.style.fontFamily = FONT_STACKS[opt.value] || FONT_STACKS["dejavu-sans"];
  li.addEventListener("click", () => chooseFont(opt.value));
  return li;
}

function buildFontPicker() {
  const sel = $("labelFont");
  fontList.replaceChildren();
  for (const group of sel.children) {
    if (group.tagName === "OPTGROUP") {
      const head = document.createElement("li");
      head.className = "font-picker-group";
      head.setAttribute("role", "presentation");
      head.textContent = group.label;
      fontList.appendChild(head);
      for (const opt of group.children) fontList.appendChild(fontItem(opt));
    } else if (group.tagName === "OPTION") {
      fontList.appendChild(fontItem(group));
    }
  }
}

/* The closed control shows the current face too, bold state included. */
function syncFontPicker() {
  const sel = $("labelFont");
  const opt = sel.selectedOptions[0];
  const btn = $("fontPickerBtn");
  $("fontPickerLabel").textContent = opt ? opt.textContent : "Font";
  btn.style.fontFamily = labelStack();
  btn.style.fontWeight = S.text.bold ? "700" : "400";
  for (const li of fontList.children) {
    if (!li.dataset.value) continue;
    const on = li.dataset.value === sel.value;
    li.classList.toggle("is-selected", on);
    li.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function fontPickerPosition() {
  const r = $("fontPickerBtn").getBoundingClientRect();
  const gap = 6, margin = 10;
  const roomBelow = window.innerHeight - r.bottom - gap - margin;
  const roomAbove = r.top - gap - margin;
  const up = roomBelow < 220 && roomAbove > roomBelow;
  // Widen past the button when needed so long names ("Press Start 2P") fit.
  const width = Math.round(Math.min(
    Math.max(r.width, 300), Math.max(200, window.innerWidth - 2 * margin)
  ));
  fontList.style.width = width + "px";
  fontList.style.left = Math.min(
    Math.max(margin, r.left), Math.max(margin, window.innerWidth - width - margin)
  ) + "px";
  fontList.style.maxHeight = Math.round(Math.max(160, Math.min(360, up ? roomAbove : roomBelow))) + "px";
  fontList.style.top = up ? "auto" : Math.round(r.bottom + gap) + "px";
  fontList.style.bottom = up ? Math.round(window.innerHeight - r.top + gap) + "px" : "auto";
}

function onFontDocDown(e) {
  const btn = $("fontPickerBtn");
  if (fontList.contains(e.target) || btn === e.target || btn.contains(e.target)) return;
  closeFontPicker(false);
}

function openFontPicker() {
  if (fontPickerOpen) return;
  fontPickerOpen = true;
  syncFontPicker();
  fontList.hidden = false;
  $("fontPickerBtn").setAttribute("aria-expanded", "true");
  fontPickerPosition();
  const current = fontList.querySelector(".font-picker-item.is-selected")
    || fontList.querySelector(".font-picker-item");
  if (current) {
    current.focus({ preventScroll: true });
    // Centre the current face so its group header sits in view above it.
    const lr = fontList.getBoundingClientRect();
    const ir = current.getBoundingClientRect();
    fontList.scrollTop += (ir.top - lr.top) - (lr.height - ir.height) / 2;
  }
  document.addEventListener("pointerdown", onFontDocDown, true);
}

function closeFontPicker(focusButton = false) {
  if (!fontPickerOpen) return;
  fontPickerOpen = false;
  fontList.hidden = true;
  $("fontPickerBtn").setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", onFontDocDown, true);
  if (focusButton) $("fontPickerBtn").focus();
}

function chooseFont(value) {
  const sel = $("labelFont");
  closeFontPicker(true);
  if (sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

$("fontPickerBtn").addEventListener("click", () => {
  if (fontPickerOpen) closeFontPicker(true);
  else openFontPicker();
});
$("fontPickerBtn").addEventListener("keydown", (e) => {
  if (fontPickerOpen) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openFontPicker();
  }
});
fontList.addEventListener("keydown", (e) => {
  const items = [...fontList.querySelectorAll(".font-picker-item")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, i + step));
    items[next].focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    items[e.key === "Home" ? 0 : items.length - 1].focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (i >= 0) items[i].click();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFontPicker(true);
  } else if (e.key === "Tab") {
    closeFontPicker(false);
  }
});
window.addEventListener("scroll", (e) => {
  if (fontPickerOpen && !fontList.contains(e.target)) closeFontPicker(false);
}, true);
window.addEventListener("resize", () => {
  if (fontPickerOpen) fontPickerPosition();
});

buildFontPicker();

/* ---------------- label wiring ----------------
   One writer per field: the text box, select, switches, sliders and the colour
   pair all funnel through syncLabelUI(), so canvas, read-outs and the saved
   design cannot drift apart. Each label keeps its own font/size/position/colour;
   the strip chooses which one those controls edit. */
function labelName(t, i) {
  const v = String((t && t.value) || "").trim();
  return v ? `“${v}”` : `label ${i + 1} — type to fill it`;
}

function paintLabels() {
  const strip = $("labelStrip");
  if (!strip) return;
  strip.textContent = "";
  const list = S.labels || [];
  list.forEach((t, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    const filled = !!String(t.value || "").trim();
    chip.className = "label-chip" + (i === S.activeLabel ? " active" : "") + (filled ? "" : " empty");
    chip.title = labelName(t, i) + " · " + (t.colour || "").toUpperCase();
    chip.setAttribute("aria-label", "Label " + (i + 1) + ": " + labelName(t, i));
    if (filled) {
      /* The chip previews the label in its own colour and face, so three labels
         are distinguishable in the strip without opening the colour row. */
      chip.textContent = String(t.value).trim().slice(0, 3);
      chip.style.color = t.colour;
      chip.style.fontFamily = labelStack(t);
    } else {
      chip.innerHTML = `<span class="layer-plus">+</span>`;
    }
    chip.addEventListener("click", () => {
      S.activeLabel = i;
      syncLabelUI();
    });
    strip.appendChild(chip);
  });
  const n = list.length;
  const filled = list.filter((t) => String(t.value || "").trim()).length;
  if ($("labelNote")) $("labelNote").textContent = filled + " of " + n + (n === 1 ? " label" : " labels");
  if ($("labelRemove")) $("labelRemove").disabled = n <= 1;
}

function addLabel() {
  S.labels.push({ ...TEXT_DEFAULT, colour: S.text.colour });
  S.activeLabel = S.labels.length - 1;
  syncLabelUI();
  const box = $("labelText");
  if (box) box.focus();
}

function removeLabel() {
  if ((S.labels || []).length <= 1) return;
  S.labels.splice(S.activeLabel, 1);
  S.activeLabel = Math.max(0, Math.min(S.activeLabel, S.labels.length - 1));
  syncLabelUI();
}

function syncLabelUI() {
  $("labelText").value = S.text.value;
  $("labelFont").value = S.text.font;
  syncFontPicker();
  $("labelBold").checked = !!S.text.bold;
  $("labelSize").value = Math.round(S.text.size * 100);
  $("labelSizeOut").textContent = Math.round(S.text.size * 100) + "%";
  $("labelX").value = Math.round(S.text.x * 100);
  $("labelXOut").textContent = Math.round(S.text.x * 100) + "%";
  $("labelY").value = Math.round(S.text.y * 100);
  $("labelYOut").textContent = Math.round(S.text.y * 100) + "%";
  $("labelRot").value = Math.round(labelRot());
  $("labelRotOut").textContent = Math.round(labelRot()) + "°";
  $("labelHex").value = S.text.colour.toUpperCase();
  $("labelPick").value = S.text.colour;
  paintLabels();
}

function setLabelColour(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) { $("labelHex").value = S.text.colour.toUpperCase(); return; }
  S.text.colour = rgbToHex(...rgb);
  syncLabelUI();
  render(); save();
}

$("labelText").addEventListener("input", (e) => {
  S.text.value = e.target.value;
  paintLabels();
  render(); save();
});
$("labelFont").addEventListener("change", (e) => {
  S.text.font = e.target.value;
  syncFontPicker();
  paintLabels();
  render(); save();
});
$("labelAdd").addEventListener("click", addLabel);
$("labelRemove").addEventListener("click", removeLabel);
$("labelBold").addEventListener("change", (e) => {
  S.text.bold = e.target.checked;
  syncFontPicker();
  render(); save();
});
$("labelSize").addEventListener("input", (e) => {
  S.text.size = Number(e.target.value) / 100;
  $("labelSizeOut").textContent = Math.round(S.text.size * 100) + "%";
  render(); save();
});
$("labelX").addEventListener("input", (e) => {
  S.text.x = Number(e.target.value) / 100;
  $("labelXOut").textContent = Math.round(S.text.x * 100) + "%";
  render(); save();
});
$("labelY").addEventListener("input", (e) => {
  S.text.y = Number(e.target.value) / 100;
  $("labelYOut").textContent = Math.round(S.text.y * 100) + "%";
  render(); save();
});
$("labelRot").addEventListener("input", (e) => {
  S.text.rot = Number(e.target.value) || 0;
  $("labelRotOut").textContent = Math.round(labelRot()) + "°";
  render(); save();
});
$("labelHex").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  setLabelColour(v.startsWith("#") ? v : "#" + v);
});
$("labelPick").addEventListener("input", (e) => setLabelColour(e.target.value));
$("labelFromIcon").addEventListener("click", () => setLabelColour(S.fg));
$("exportBtn").addEventListener("click", () => {
  clearTimeout(designTimer);
  designTimer = null;
  saveDesign();      // the export is always in the library
  exportSet();
});
$("designName").addEventListener("input", (e) => {
  S.designName = e.target.value;
  scheduleDesignSave();
});
$("designName").addEventListener("change", () => { scheduleDesignSave(); });
$("designSave").addEventListener("click", () => {
  clearTimeout(designTimer);
  designTimer = null;
  if (!hasGlyph()) { setDesignNote("pick a glyph first"); return; }
  saveDesign();
});
$("designNew").addEventListener("click", newDesign);
$("pngBtn").addEventListener("click", () => {
  const p = primaryIcon();
  stage.toBlob((b) => download(b, `${slug(p && p.name)}-1024.png`), "image/png");
});
$("svgBtn").addEventListener("click", () => {
  const p = primaryIcon();
  download(new Blob([compositeSvg()], { type: "image/svg+xml" }), `${slug(p && p.name)}.svg`);
});

/* Copy the finished icon to the clipboard as a real image, not as markup.
   The complaint this fixes: the button used to put only SVG *source* on the
   clipboard, so pasting into a doc, a chat or an image editor gave you the
   parameters instead of the picture. Now one clipboard entry carries two
   flavours: image/png (256 px, downscaled from the 1024 stage canvas — what
   every paste target honours) and text/plain (the server-baked SVG markup, for
   an editor that wants the vector source).
   image/png is a sanitized flavour Chrome on Linux accepts; image/svg+xml is
   rejected there. execCommand remains the last-resort fallback because the
   tailnet URL (http://100.x…) is not a secure context and has no
   navigator.clipboard. */
const COPY_PX = 256;

function stagePng(size = COPY_PX) {
  return new Promise((res, rej) => {
    const off = document.createElement("canvas");
    off.width = off.height = size;
    const octx = off.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(stage, 0, 0, size, size); // 1024 stage -> COPY_PX
    off.toBlob((b) => (b ? res(b) : rej(new Error("could not rasterise the icon"))), "image/png");
  });
}

async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return "clipboard"; } catch (e) { /* fall through */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  if (!ok) throw new Error("clipboard blocked by the browser");
  return "execCommand";
}

/* An http:// origin (the tailnet URL the launcher cards link to, e.g.
   http://100.x…:7876) is not a secure context, so navigator.clipboard does not
   exist there and *no browser API can put a bitmap on the clipboard* —
   execCommand only ever yields text. Verified on Wayland Chromium: HTTPS origin
   → clipboard types text/plain, text/html, image/png; the same page over http
   → text/plain only, even when copying a selected <img>. So the honest split is:
   secure context = image; plain http = tell the user why, once, instead of
   silently handing back markup. */
function insecureHint() {
  const port = location.port ? ":" + location.port : "";
  return `copy: an http:// origin can't put images on the clipboard — `
    + `open http://127.0.0.1${port}/ (or an https:// URL) instead`;
}

async function copyIcon(pngBlob, svgText) {
  const canWrite = window.isSecureContext && navigator.clipboard
    && navigator.clipboard.write && window.ClipboardItem;
  if (canWrite) {
    /* image/png first, text/html as the rich-text carrier. No text/plain SVG:
       apps that prefer plain text (DeckCraft's Ctrl+V, for one) then paste the
       markup — the "it copies the parameters" bug — so the markup stays behind
       the SVG download button and the clipboard carries only the picture. */
    const html = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(`<img src="${fr.result}" width="${COPY_PX}" height="${COPY_PX}" alt="icon">`);
      fr.onerror = () => res("");
      fr.readAsDataURL(pngBlob);
    });
    const full = { "image/png": pngBlob };
    if (html) full["text/html"] = new Blob([html], { type: "text/html" });
    for (const flavours of [full, { "image/png": pngBlob }]) {
      try { await navigator.clipboard.write([new ClipboardItem(flavours)]); return "image"; }
      catch (e) { console.warn("clipboard image write failed", e); }
    }
  }
  if (!svgText) throw new Error("clipboard needs a secure context to take images");
  await copyText(svgText);
  return "text";
}

$("svgCopyBtn").addEventListener("click", async () => {
  const p = primaryIcon();
  if (!p) return;
  const btn = $("svgCopyBtn");
  const note = $("exportNote");
  const idle = note.textContent;
  btn.disabled = true;
  try {
    await render(); // the stage must show exactly what S says before we read it
    const png = await stagePng();
    let svg = "";
    try {
      const res = await fetch("/api/export/svg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          svg: compositeSvg(),
          font: S.text.font,
          label: (S.text.value || "").trim(),
          /* Every label, so the server can bake each face the SVG names — the
             markup alone cannot say which font id a family came from. */
          labels: visibleLabels().map((t) => ({ font: t.font, value: t.value })),
        }),
      });
      if (res.ok) svg = await res.text();
    } catch (e) { console.warn("svg flavour unavailable", e); }
    const how = await copyIcon(png, svg);
    btn.textContent = "Copied";
    if (how === "image") {
      note.textContent = `icon copied · ${COPY_PX} px png`;
    } else {
      note.textContent = insecureHint();
      setTimeout(() => { note.textContent = idle; }, 6000);
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1400);
  } catch (e) {
    console.error(e);
    note.textContent = "copy failed: " + e.message;
    setTimeout(() => { note.textContent = idle; }, 4000);
  } finally {
    btn.disabled = false;
  }
});

$("themeSelect").addEventListener("change", (e) => {
  document.documentElement.setAttribute("data-theme", e.target.value);
  localStorage.setItem("iconLibrary.theme", e.target.value);
  paintGrid(); // remote thumbs take their colour from the theme
});

/* ---------------- persistence ---------------- */
const snapIcon = (ic) => (ic ? {
  id: ic.id, prefix: ic.prefix, name: ic.name, w: ic.w, h: ic.h, body: ic.body,
  remote: ic.remote, collection: ic.collection, spdx: ic.spdx,
  license_title: ic.license_title, license_url: ic.license_url, author: ic.author,
} : null);

/* Everything that makes this icon this icon: colours, shape, label, every glyph
   with its size / position / rotation, and the SVG bodies so a restore needs no
   search. Shared by localStorage and the design library, so a saved design and a
   page reload can never restore different things. */
function designPayload() {
  return {
    bg: S.bg, fg: S.fg, autoFg: S.autoFg, gray: S.gray,
    shape: S.shape, transparent: S.transparent,
    /* `text` is the active label, kept for payload readers that predate multiple
       labels; `labels` is the real list. */
    text: { ...S.text },
    labels: (S.labels || []).map((t) => ({ ...t })),
    activeLabel: S.activeLabel,
    active: S.active,
    layers: S.layers.map((l) => ({
      icon: snapIcon(l.icon), size: l.size, x: l.x, y: l.y, rot: l.rot,
      ink: l.ink || null,
    })),
    // Kept so a page running an older build still restores something sane.
    inset: S.inset, rotation: S.rotation, icon: snapIcon(S.icon),
    designId: S.designId, designName: S.designName,
  };
}

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(designPayload()));
  } catch (e) { /* quota — ignore */ }
  scheduleDesignSave();
}

const frac = (v, dflt, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : dflt;
};

/* Apply a saved design (localStorage or library record) onto S. UI syncing is
   the caller's job — loadDesign and restore() both call syncComposerUI(). */
function applyDesign(raw) {
  if (!raw || typeof raw !== "object") return;
  S.bg = hexToRgb(raw.bg) ? rgbToHex(...hexToRgb(raw.bg)) : S.bg;
  /* Ink is per layer now. A payload from before that carries no per-layer ink
     keeps its exact look: a manual colour is frozen onto every glyph, an auto
     one goes on following the background. */
  const legacyInk = hexToRgb(raw.fg) ? rgbToHex(...hexToRgb(raw.fg)) : null;
  const layeredInk = Array.isArray(raw.layers) && raw.layers.some((l) => l && "ink" in l);
  const legacyLayerInk = (!layeredInk && raw.autoFg === false && legacyInk) ? legacyInk : null;
  S.gray = !!raw.gray;
  S.shape = ["squircle", "circle", "square", "full"].includes(raw.shape) ? raw.shape : S.shape;
  S.transparent = !!raw.transparent;
  const oneLabel = (t) => ({
    value: typeof t.value === "string" ? t.value : "",
    size: Number(t.size) > 0 ? clamp(Number(t.size), 0.04, 1) : TEXT_DEFAULT.size,
    x: Number.isFinite(Number(t.x)) ? clamp(Number(t.x), 0, 1) : TEXT_DEFAULT.x,
    y: Number.isFinite(Number(t.y)) ? clamp(Number(t.y), 0, 1) : TEXT_DEFAULT.y,
    rot: Number.isFinite(Number(t.rot)) ? clamp(Number(t.rot), 0, 359) : TEXT_DEFAULT.rot,
    font: FONT_STACKS[t.font] ? t.font : TEXT_DEFAULT.font,
    bold: t.bold !== false,
    colour: hexToRgb(t.colour) ? rgbToHex(...hexToRgb(t.colour)) : TEXT_DEFAULT.colour,
  });
  if (Array.isArray(raw.labels) && raw.labels.length) {
    S.labels = raw.labels.slice(0, 12)
      .filter((t) => t && typeof t === "object")
      .map(oneLabel);
    if (!S.labels.length) S.labels = [{ ...TEXT_DEFAULT }];
    S.activeLabel = clamp(Math.round(Number(raw.activeLabel) || 0), 0, S.labels.length - 1);
  } else if (raw.text && typeof raw.text === "object") {
    /* Pre-multi-label payload: one label, which is what it looked like. */
    S.labels = [oneLabel(raw.text)];
    S.activeLabel = 0;
  }

  if (Array.isArray(raw.layers) && raw.layers.length) {
    S.layers = raw.layers.slice(0, 12).map((l) => makeLayer(l && l.icon ? l.icon : null, {
      size: frac(l && l.size, 0.56, 0.04, 1.4),
      x: frac(l && l.x, 0.5, 0, 1),
      y: frac(l && l.y, 0.5, 0, 1),
      rot: frac(l && l.rot, 0, 0, 359),
      ink: (l && hexToRgb(l.ink)) ? rgbToHex(...hexToRgb(l.ink)) : legacyLayerInk,
    }));
    S.active = clamp(Math.round(Number(raw.active) || 0), 0, S.layers.length - 1);
  } else if (raw.icon) {
    /* Pre-layers saved design: one glyph at the old global size/rotation,
       centred — which is exactly what it looked like before. */
    S.layers = [makeLayer(raw.icon, {
      size: frac(raw.inset, 0.56, 0.04, 1.4),
      rot: frac(raw.rotation, 0, 0, 359),
      ink: legacyLayerInk,
    })];
    S.active = 0;
  }
  S.designId = typeof raw.designId === "string" && /^[0-9a-f]{12}$/.test(raw.designId)
    ? raw.designId : null;
  S.designName = typeof raw.designName === "string" ? raw.designName : "";
}

/* Push S at every control that mirrors it. One writer per control, so a
   restored design cannot disagree with what the sliders show. */
function syncComposerUI() {
  $("autoFg").checked = S.autoFg;
  $("gray").checked = S.gray;
  $("grayState").textContent = S.gray ? "on" : "off";
  $("transparent").checked = S.transparent;
  syncBgControls();
  [...$("shapeSeg").children].forEach((b) => b.classList.toggle("active", b.dataset.shape === S.shape));
  applyBg(S.bg);           // also renders + saves
  syncLabelUI();
  syncLayerUI();
  $("designName").value = S.designName;
  paintDesigns();
}

function restore() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { raw = null; }
  applyDesign(raw);

  const theme = localStorage.getItem("iconLibrary.theme");
  if (theme) { $("themeSelect").value = theme; document.documentElement.setAttribute("data-theme", theme); }

  syncComposerUI();
  showTab(localStorage.getItem("iconLibrary.tab") || "icons");
}

/* ---------------- design library ----------------
   Every icon that reaches a state worth keeping is filed on the server
   (data/designs/<id>.json + .png) about a second after the last change, so a
   previous icon can be reopened and adjusted instead of rebuilt. The library is
   keyed by design id, not by glyph: tweak and it updates in place; "+ New design"
   starts a fresh record. */
const DESIGN_API = "/api/designs";
let designTimer = null;
let designBusy = false;
let designSuppress = false;   // true while a design is being applied, so loading
                              // it cannot immediately re-save it

const hasGlyph = () => S.layers.some((l) => l && l.icon);

function autoDesignName() {
  const p = primaryIcon();
  const base = p ? p.name : "icon";
  const first = (S.labels || []).find((t) => String(t.value || "").trim());
  const label = first ? String(first.value).trim() : "";
  return label ? `${base} ${label}` : base;
}

function designThumb() {
  const c = document.createElement("canvas");
  c.width = 160; c.height = 160;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(stage, 0, 0, 160, 160);
  return c.toDataURL("image/png");
}

function setDesignNote(text) {
  const n = $("designNote");
  if (n) n.textContent = text;
}

function scheduleDesignSave() {
  if (designSuppress || !hasGlyph()) return;
  clearTimeout(designTimer);
  designTimer = setTimeout(() => { designTimer = null; saveDesign(); }, 1100);
}

async function saveDesign() {
  if (!hasGlyph()) return null;
  if (designBusy) { scheduleDesignSave(); return null; }
  designBusy = true;
  try {
    const res = await fetch(DESIGN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: S.designId,
        name: (S.designName || "").trim() || autoDesignName(),
        glyphs: S.layers.filter((l) => l.icon).map((l) => `${l.icon.prefix}:${l.icon.name}`),
        bg: S.transparent ? "transparent" : S.bg,
        shape: S.shape,
        state: designPayload(),
        thumb: designThumb(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
    S.designId = data.id;
    if (!S.designName) S.designName = data.name;
    $("designName").value = S.designName;
    setDesignNote("saved " + timeAgo(data.updated));
    refreshDesigns();
    return data.id;
  } catch (e) {
    setDesignNote("not saved — server unreachable");
    return null;
  } finally {
    designBusy = false;
  }
}

function timeAgo(secs) {
  const d = Date.now() / 1000 - Number(secs || 0);
  if (!Number.isFinite(d) || d < 0) return "just now";
  if (d < 60) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  const date = new Date(Number(secs) * 1000);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

async function refreshDesigns() {
  try {
    const data = await (await fetch(`${DESIGN_API}?limit=200`)).json();
    S.designs = Array.isArray(data.designs) ? data.designs : [];
  } catch (e) {
    S.designs = S.designs || [];
  }
  paintDesigns();
}

function paintDesigns() {
  const grid = $("designGrid");
  if (!grid) return;
  const list = S.designs || [];
  $("designCount").textContent = list.length ? String(list.length) : "";
  grid.textContent = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nothing filed yet — pick a glyph and this stage files itself.";
    grid.appendChild(p);
    return;
  }
  list.forEach((d) => {
    const card = document.createElement("div");
    card.className = "design-card" + (d.id === S.designId ? " active" : "");
    card.setAttribute("role", "listitem");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "design-open";
    open.title = "Open “" + d.name + "”";
    const thumb = document.createElement("img");
    thumb.className = "design-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    if (d.has_thumb) thumb.src = `${DESIGN_API}/${d.id}/thumb.png`;
    const name = document.createElement("span");
    name.className = "design-name";
    name.textContent = d.name;
    const meta = document.createElement("span");
    meta.className = "design-meta";
    const glyphs = (d.glyphs || []).map((g) => String(g).split(":")[1] || g);
    meta.textContent = (glyphs.length > 1 ? glyphs.length + " glyphs · " : "")
      + (glyphs[0] || "") + " · " + timeAgo(d.updated);
    open.append(thumb, name, meta);
    open.addEventListener("click", () => loadDesign(d.id));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "design-del";
    del.textContent = "✕";
    del.title = "Delete this design";
    del.setAttribute("aria-label", "Delete design " + d.name);
    let armTimer = null;
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!del.classList.contains("armed")) {
        del.classList.add("armed");
        del.textContent = "sure?";
        armTimer = setTimeout(() => { del.classList.remove("armed"); del.textContent = "✕"; }, 3000);
        return;
      }
      clearTimeout(armTimer);
      deleteDesign(d.id);
    });

    card.append(open, del);
    grid.appendChild(card);
  });
}

async function loadDesign(id) {
  if (!id) return;
  clearTimeout(designTimer);
  designTimer = null;
  // File whatever is on the stage before replacing it, so nothing is lost.
  if (hasGlyph()) { try { await saveDesign(); } catch (e) { /* offline */ } }
  let rec = null;
  try {
    const res = await fetch(`${DESIGN_API}/${id}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    rec = await res.json();
  } catch (e) {
    setDesignNote("could not open that design");
    return;
  }
  designSuppress = true;
  S.layers = [makeLayer(null)];
  S.active = 0;
  S.labels = [{ ...TEXT_DEFAULT }];
  S.activeLabel = 0;
  applyDesign(rec.state || {});
  S.designId = rec.id;
  S.designName = rec.name || "";
  S.lastSrc = null;
  designSuppress = false;
  syncComposerUI();
  setDesignNote("opened " + timeAgo(rec.updated));
  save();  // mirror into localStorage; files into the same record
  showTab("designs");
}

async function newDesign() {
  clearTimeout(designTimer);
  designTimer = null;
  if (hasGlyph()) await saveDesign();
  designSuppress = true;
  S.layers = [makeLayer(null)];
  S.active = 0;
  S.labels = [{ ...TEXT_DEFAULT, colour: S.fg }];
  S.activeLabel = 0;
  S.designId = null;
  S.designName = "";
  S.lastSrc = null;
  designSuppress = false;
  syncComposerUI();
  setDesignNote("new design" + (S.transparent ? " · transparent" : " · " + S.bg));
  save();
  showTab("icons");   // back to the grid, ready for the first glyph
}

async function deleteDesign(id) {
  try {
    const res = await fetch(`${DESIGN_API}/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
  } catch (e) {
    setDesignNote("delete failed — server unreachable");
    return;
  }
  if (S.designId === id) {
    // The stage stays as it is; the next edit files a new record rather than
    // resurrecting the one that was just deleted.
    S.designId = null;
    setDesignNote("deleted — next change saves as a new design");
  }
  refreshDesigns();
}

/* ---------------- launcher mode ----------------
   The app launcher opens this page with ?launcher=<origin>&slug=<slug>&name=&bg=
   when a card is right-clicked → Replace icon…. Designing is unchanged; "Save to
   launcher" posts the composite SVG to /api/launcher-icon, which forwards it to
   the launcher's /api/icon/<slug>. Closing the window writes nothing. */
const LAUNCH_TARGET = (() => {
  const p = new URLSearchParams(location.search);
  const launcher = p.get("launcher");
  const slug = p.get("slug");
  if (!launcher || !slug) return null;
  return { launcher, slug, name: p.get("name") || slug, bg: p.get("bg") || "",
           presets: parsePresets(p.get("presets")) };
})();

/* `key~name~#hex` triples joined with "|" — the launcher's group palette, in
   group order. Only usable hex colours are kept: a preset the wheel cannot
   represent must not blank the swatch row. */
function parsePresets(raw) {
  if (!raw) return [];
  return raw.split("|").map((chunk) => {
    const [key, name, hex] = chunk.split("~");
    const rgb = hexToRgb(hex);
    if (!key || !rgb) return null;
    return { key, name: name || key, hex: rgbToHex(...rgb) };
  }).filter(Boolean);
}

/* Group colours as one-tap swatches: a card icon is meant to match the colour of
   the group it sits in, and picking one from the wheel is guesswork. The row is
   built from the launcher's own palette (passed in the URL), so the presets can
   never drift from the colour the launcher paints the group's chips and tiles. */
function buildPresetRow(presets) {
  const row = $("bgPresets");
  const list = presets || LAUNCH_TARGET.presets;
  if (!row || !list.length) return false;
  row.textContent = "";
  list.forEach((preset) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-preset";
    b.dataset.hex = preset.hex;
    b.style.setProperty("--swatch", preset.hex);
    // Size and fill inline as well as via CSS: a stale stylesheet used to leave
    // these buttons zero-size and the row invisible, which reads as "no presets".
    b.style.width = b.style.height = "34px";
    b.style.background = preset.hex;
    b.style.borderRadius = "50%";
    b.title = preset.name + " — " + preset.hex.toUpperCase();
    b.setAttribute("aria-label", "Background " + preset.name + " " + preset.hex);
    b.addEventListener("click", () => { applyBg(preset.hex); noteRecent(preset.hex); });
    row.appendChild(b);
  });
  row.classList.remove("hidden");
  syncPresetActive();
  return true;
}

/* No presets in the URL: the launcher window that opened this page predates the
   palette, so ask its server for the colours instead of leaving the row blank
   and making the user reload. Same palette, same order, one extra round trip. */
function loadPresetsFromLauncher() {
  const note = $("launcherNote");
  if (note) note.textContent = "Loading the launcher's group colours…";
  fetch("/api/launcher-groups?launcher=" + encodeURIComponent(LAUNCH_TARGET.launcher))
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      const presets = ok ? parsePresets(d.presets) : [];
      if (presets.length && buildPresetRow(presets)) {
        if (note) {
          note.textContent = "Pick a glyph, set the colour, then Save — the card updates straight away.";
        }
      } else if (note) {
        note.textContent = "Group colour presets unavailable (launcher unreachable).";
      }
    })
    .catch(() => { if (note) note.textContent = "Group colour presets unavailable (launcher unreachable)."; });
}

function syncPresetActive() {
  const row = $("bgPresets");
  if (!row) return;
  const current = (S.bg || "").toLowerCase();
  [...row.children].forEach((b) => {
    b.classList.toggle("active", (b.dataset.hex || "").toLowerCase() === current);
  });
}

function initLauncherMode() {
  if (!LAUNCH_TARGET) return;
  const bar = $("launcherBar");
  if (!bar) return;
  bar.classList.remove("hidden");
  $("launcherTarget").textContent = "Replacing “" + LAUNCH_TARGET.name + "” icon";
  document.title = "Replace icon — " + LAUNCH_TARGET.name;

  if (!buildPresetRow()) loadPresetsFromLauncher();

  // Start from the card's group colour so a replacement matches its neighbours,
  // and with nothing selected: restoring the last design would let Save write an
  // unrelated icon over this card without the user choosing anything.
  const rgb = hexToRgb(LAUNCH_TARGET.bg);
  if (rgb) applyBg(rgbToHex(rgb[0], rgb[1], rgb[2]));
  S.layers = [makeLayer(null)];
  S.active = 0;
  S.lastSrc = null;
  syncLayerUI();
  render();

  $("lbSave").addEventListener("click", saveToLauncher);
  $("lbCancel").addEventListener("click", abortLauncher);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") abortLauncher();
  });
}

async function saveToLauncher() {
  if (!LAUNCH_TARGET) return;
  const svg = compositeSvg();
  if (!svg) return;
  const btn = $("lbSave");
  const note = $("launcherNote");
  btn.disabled = true;
  btn.textContent = "Saving…";
  note.textContent = "Writing the icon to the launcher…";
  try {
    const res = await fetch("/api/launcher-icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ launcher: LAUNCH_TARGET.launcher, slug: LAUNCH_TARGET.slug, svg, name: LAUNCH_TARGET.name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || "HTTP " + res.status);

    // The launcher tab repaints the card on this message; without it the icon
    // there would only change on the next page load.
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "launcher-icon-replaced", slug: LAUNCH_TARGET.slug }, "*");
      }
    } catch (e) { /* opener gone — a reload still picks the icon up */ }

    btn.textContent = "Saved";
    note.textContent = "Icon replaced on the launcher card"
      + (data.backup ? " — the old file is in icons/.icon-backups/" : "")
      + ". Closing…";
    setTimeout(() => {
      try { window.close(); } catch (e) { /* not script-opened */ }
      note.textContent = "Saved. Close this tab when you are done.";
    }, 1100);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Save to launcher";
    note.textContent = "Save failed: " + e.message;
  }
}

function abortLauncher() {
  // Nothing has been written at this point, so aborting is just closing.
  try { window.close(); } catch (e) {}
  setTimeout(() => {
    const note = $("launcherNote");
    if (note) note.textContent = "Aborted — the card icon is unchanged. Close this tab.";
  }, 250);
}

/* Boot ------------------------------------------------------------------ */
/* The composer is capped so the whole thing — stage, tabs, sliders, export row —
   fits the window. The cap is measured from where the pane actually sits (a
   font-loaded topbar is taller than the CSS fallback assumes), and only the open
   tab panel scrolls. On desktop it is then pinned, so the preview stays put
   while the results grid scrolls underneath. */
function syncSticky() {
  const c = document.querySelector(".composer");
  if (!c) return;
  c.classList.remove("stick");
  c.style.maxHeight = "";
  if (window.innerWidth <= 860) return;   // mobile scrolls the page instead
  const top = c.getBoundingClientRect().top;
  const avail = Math.round(window.innerHeight - top - 16);
  c.style.maxHeight = Math.max(320, avail) + "px";
  c.classList.add("stick");
}

const SUGGESTIONS = ["umbrella", "weather", "arrow", "home", "coffee", "music",
                     "camera", "shield", "heart", "cloud"];

async function boot() {
  restore();
  initLauncherMode();
  drawWheel();
  refreshDesigns();

  const sugg = $("suggestions");
  SUGGESTIONS.forEach((word) => {
    const b = document.createElement("button");
    b.className = "chip-btn";
    b.textContent = word;
    b.addEventListener("click", () => { $("q").value = word; runSearch(true); });
    sugg.appendChild(b);
  });

  try {
    const h = await (await fetch("/api/health")).json();
    $("stats").textContent =
      `${h.icons.toLocaleString()} icons · ${h.collections} sets · ${h.db_mb} MB`
      + (h.online ? " · live fallback" : " · offline index only");
    const cols = await (await fetch("/api/collections")).json();
    const chips = $("setChips");
    cols.collections.forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip-btn";
      b.textContent = `${c.name} ${c.count}`;
      b.addEventListener("click", () => {
        if (S.sets.has(c.prefix)) S.sets.delete(c.prefix); else S.sets.add(c.prefix);
        b.classList.toggle("on", S.sets.has(c.prefix));
        $("setsToggle").textContent = S.sets.size ? `Sets: ${S.sets.size}` : "Sets: all";
        if ($("q").value.trim()) runSearch(true);
      });
      chips.appendChild(b);
    });
  } catch (e) {
    $("stats").textContent = "server unreachable";
  }

  syncSticky();
  window.addEventListener("resize", syncSticky);
  // Web fonts change the composer's height after first paint.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncSticky);
}

boot();
