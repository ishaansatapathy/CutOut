const $ = (id) => document.getElementById(id);
const base = $('base'), cut = $('cut'), ui = $('ui'), busy = $('busy');
let sid = null, W = 0, H = 0, mode = 'add', bg = '';
let points = [], box = null, drag = null, reqId = 0, imgEl = null;

fetch('/api/info').then(r => r.json()).then(i => $('engine').textContent = 'engine: ' + i.engine);

const drop = $('drop');
['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', ev => { ev.preventDefault(); if (ev.dataTransfer.files[0]) upload(ev.dataTransfer.files[0]); });
$('file').addEventListener('change', e => e.target.files[0] && upload(e.target.files[0]));

async function upload(file) {
  if (file.size > 20 * 1024 * 1024) return alert('Image must be under 20 MB');
  const fd = new FormData(); fd.append('image', file);
  $('hero').hidden = true; $('editor').hidden = false; busy.classList.add('on'); busy.textContent = 'Encoding…';
  const r = await fetch('/v1/images/session', { method: 'POST', body: fd });
  if (!r.ok) { alert((await r.json()).detail); return reset(); }
  const j = await r.json();
  sid = j.session_id; W = j.width; H = j.height;
  imgEl = await loadImg(URL.createObjectURL(file));
  for (const c of [base, cut, ui]) { c.width = W; c.height = H; }
  base.getContext('2d').drawImage(imgEl, 0, 0);
  clearAll(); busy.classList.remove('on');
}
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });

function clearAll() {
  points = []; box = null; cut.getContext('2d').clearRect(0, 0, W, H);
  base.style.visibility = 'visible'; drawUI();
}
function reset() { sid = null; $('editor').hidden = true; $('hero').hidden = false; $('file').value = ''; }
$('reset').onclick = reset;
$('undo').onclick = () => { if (box) box = null; else points.pop(); (points.length || box) ? segment() : clearAll(); drawUI(); };

$('modes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.mode; [...$('modes').children].forEach(x => x.classList.toggle('active', x === b));
});
$('bgs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  bg = b.dataset.bg; [...$('bgs').children].forEach(x => x.classList.toggle('active', x === b));
  $('stage').style.background = bg || ''; $('stage').classList.toggle('checker', !bg);
});

function pos(e) {
  const r = ui.getBoundingClientRect();
  return { x: Math.round((e.clientX - r.left) * W / r.width), y: Math.round((e.clientY - r.top) * H / r.height) };
}
ui.addEventListener('pointerdown', e => { drag = pos(e); drag.cur = drag; ui.setPointerCapture(e.pointerId); });
ui.addEventListener('pointermove', e => { if (drag && mode === 'box') { drag.cur = pos(e); drawUI(); } });
ui.addEventListener('pointerup', e => {
  if (!drag) return; const p = pos(e);
  if (mode === 'box') {
    const d = Math.hypot(p.x - drag.x, p.y - drag.y);
    if (d > 8) box = [Math.min(drag.x, p.x), Math.min(drag.y, p.y), Math.max(drag.x, p.x), Math.max(drag.y, p.y)];
    else return (drag = null, drawUI());
  } else points.push({ ...p, label: mode === 'add' ? 1 : 0 });
  drag = null; drawUI(); segment();
});

function drawUI() {
  const c = ui.getContext('2d'); c.clearRect(0, 0, W, H);
  const s = Math.max(W, H) / 700;
  if (box || (drag && mode === 'box')) {
    const b = box || [drag.x, drag.y, drag.cur.x, drag.cur.y];
    c.strokeStyle = '#22d3ee'; c.lineWidth = 2.5 * s; c.setLineDash([8 * s, 6 * s]);
    c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  }
  c.setLineDash([]);
  for (const p of points) {
    c.beginPath(); c.arc(p.x, p.y, 7 * s, 0, 7);
    c.fillStyle = p.label ? '#22c55e' : '#ef4444'; c.fill();
    c.lineWidth = 2.5 * s; c.strokeStyle = '#fff'; c.stroke();
  }
}

async function segment() {
  const id = ++reqId; busy.textContent = 'Segmenting…'; busy.classList.add('on');
  const r = await fetch(`/v1/images/session/${sid}/segment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points, box })
  });
  if (id !== reqId) return; // stale response
  busy.classList.remove('on');
  if (!r.ok) return alert((await r.json()).detail || 'Failed');
  const img = await loadImg(URL.createObjectURL(await r.blob()));
  const c = cut.getContext('2d'); c.clearRect(0, 0, W, H); c.drawImage(img, 0, 0);
  base.style.visibility = 'hidden';
}

$('download').onclick = async () => {
  if (!points.length && !box) return alert('Select a subject first');
  const r = await fetch(`/v1/images/session/${sid}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: bg || null })
  });
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'cutout.png'; a.click();
};
