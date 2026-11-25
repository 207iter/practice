'use strict';
// 노을 편대 — 횡스크롤 비행 슈팅. 외부 파일 없이 캔버스와 WebAudio만 사용한다.

const W = 960, H = 540, STEP = 1 / 60, TAU = Math.PI * 2;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const FONT = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/* ---------- 화면 크기 ---------- */
let view = 1;
function resize() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
  canvas.width = Math.round(W * s * dpr);
  canvas.height = Math.round(H * s * dpr);
  view = canvas.width / W;
}
addEventListener('resize', resize);
resize();

/* ---------- 저장 (막혀 있어도 게임은 동작) ---------- */
function loadBest() { try { return +localStorage.getItem('dusk-best') || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem('dusk-best', v); } catch { /* 저장 불가 */ } }

/* ---------- 소리 ---------- */
let audio = null, noiseBuf = null, muted = false;
function initAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (audio.state === 'suspended') audio.resume();
}
function envelope(vol, dur) {
  const g = audio.createGain(), t = audio.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(audio.destination);
  return g;
}
function tone(f0, f1, dur, type, vol, delay = 0) {
  if (!audio || muted) return;
  const t = audio.currentTime + delay, o = audio.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(envelope(vol, dur + delay));
  o.start(t); o.stop(t + dur);
}
function noise(dur, freq, vol) {
  if (!audio || muted) return;
  const s = audio.createBufferSource(), f = audio.createBiquadFilter();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  s.connect(f); f.connect(envelope(vol, dur));
  s.start(); s.stop(audio.currentTime + dur);
}
const sfx = {
  shot: () => tone(720, 260, 0.07, 'square', 0.025),
  hit: () => tone(240, 160, 0.04, 'triangle', 0.05),
  boom: () => noise(0.35, 900, 0.22),
  bigBoom: () => { noise(1.1, 500, 0.45); tone(120, 30, 0.9, 'sawtooth', 0.15); },
  hurt: () => { noise(0.3, 1600, 0.3); tone(300, 60, 0.3, 'sawtooth', 0.12); },
  item: () => [523, 659, 784].forEach((f, i) => tone(f, f, 0.12, 'triangle', 0.1, i * 0.06)),
  graze: () => tone(1500, 1900, 0.04, 'sine', 0.03),
  ready: () => [880, 1175].forEach((f, i) => tone(f, f, 0.15, 'sine', 0.1, i * 0.1)),
  pulse: () => { tone(90, 900, 0.5, 'sawtooth', 0.12); noise(0.6, 2500, 0.2); },
  alarm: () => [0, 0.35, 0.7].forEach(d => tone(440, 330, 0.28, 'square', 0.06, d)),
};

/* ---------- 스테이지 ---------- */
const STAGES = [
  { name: '붉은 구름 바다', boss: '수문장 가오리', sky: ['#33204f', '#b5476a', '#ffb36b'], sun: '#ffe0a3', hills: ['#8d3f66', '#5e2c57', '#371f44'] },
  { name: '별빛 산맥', boss: '야간 요새 올빼미', sky: ['#0a1030', '#1e2f66', '#4d6da8'], sun: '#dfe9ff', hills: ['#2b427c', '#1b2b5c', '#0f1a3d'] },
  { name: '새벽의 끝', boss: '폭풍핵 해파리', sky: ['#12495c', '#4fa396', '#f6dfa0'], sun: '#fff6d6', hills: ['#3c8580', '#255d63', '#133c47'] },
];
const STAGE_TIME = 42;

/* ---------- 게임 상태 ---------- */
let state = 'title'; // title | play | pause | clear | over | win
let G = null, best = loadBest(), clock = 0, shake = 0;

function newGame() {
  G = {
    score: 0, stage: 0, time: 0, nextWave: 1.5, banner: 3, warn: 0, clearT: 0,
    p: { x: 150, y: H / 2, r: 7, hp: 5, inv: 2, gun: 1, cool: 0, charge: 0, tilt: 0 },
    shots: [], bullets: [], enemies: [], items: [], parts: [], rings: [], texts: [],
    queue: [], boss: null, combo: 0, comboT: 0, newBest: false,
  };
  state = 'play';
}

/* ---------- 입력 ---------- */
const keys = new Set();
const touch = { id: null, x: 0, y: 0 };
let mouseAim = null, mouseFire = false, touchMode = false;
const PULSE_BTN = { x: W - 70, y: H - 70, r: 44 };
const PAUSE_BTN = { x: W - 34, y: 34, r: 24 };

const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'];
addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  initAudio();
  if (!e.repeat) {
    if (e.code === 'KeyM') muted = !muted;
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'Enter' || (e.code === 'Space' && state === 'title')) confirmKey();
    if (['KeyX', 'ShiftLeft', 'ShiftRight'].includes(e.code)) firePulse();
  }
  keys.add(e.code);
  if (/^Arrow|^Key[WASD]$/.test(e.code)) mouseAim = null;
});
addEventListener('keyup', e => keys.delete(e.code));
function releaseAll() { keys.clear(); mouseFire = false; mouseAim = null; touch.id = null; }
addEventListener('blur', () => { releaseAll(); if (state === 'play') state = 'pause'; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); if (state === 'play') state = 'pause'; } });

function togglePause() {
  if (state === 'play') state = 'pause';
  else if (state === 'pause') state = 'play';
}
function confirmKey() {
  if (state === 'pause') state = 'play';
  else if (state === 'title' || ((state === 'over' || state === 'win') && G.endT > 0.8)) newGame();
}
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
const inBtn = (q, b) => dist2(q, b) < b.r * b.r;

canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); initAudio();
  const q = pos(e);
  touchMode = e.pointerType === 'touch';
  if (state !== 'play') { confirmKey(); return; }
  if (inBtn(q, PAUSE_BTN)) { togglePause(); return; }
  if (touchMode) {
    if (inBtn(q, PULSE_BTN)) { firePulse(); return; }
    if (touch.id === null) { touch.id = e.pointerId; touch.x = q.x; touch.y = q.y; }
  } else if (e.button === 2) firePulse();
  else { mouseFire = true; mouseAim = q; }
});
canvas.addEventListener('pointermove', e => {
  if (state !== 'play') return;
  const q = pos(e);
  if (e.pointerType === 'touch') {
    if (e.pointerId !== touch.id) return;
    // 손가락이 비행기를 가리지 않도록 상대 이동
    G.p.x = clamp(G.p.x + (q.x - touch.x) * 1.3, 30, W - 60);
    G.p.y = clamp(G.p.y + (q.y - touch.y) * 1.3, 60, H - 30);
    touch.x = q.x; touch.y = q.y;
  } else mouseAim = q;
});
function pointerEnd(e) {
  if (e.pointerId === touch.id) touch.id = null;
  if (e.pointerType !== 'touch') mouseFire = false;
}
addEventListener('pointerup', pointerEnd);
addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- 적 ---------- */
const TYPES = {
  dart:    { hp: 1,  r: 14, score: 100, color: '#ff5d73' },
  swoop:   { hp: 3,  r: 18, score: 200, color: '#ffb02e' },
  chaser:  { hp: 2,  r: 15, score: 250, color: '#f071ff' },
  balloon: { hp: 12, r: 28, score: 500, color: '#56d6c9' },
  gunship: { hp: 24, r: 34, score: 900, color: '#9db4ff' },
};
function spawn(type, x, y, extra) {
  const t = TYPES[type];
  G.enemies.push({ type, x, y, y0: y, t: rand(0, 1), r: t.r, hp: t.hp + G.stage * (t.hp > 5 ? 4 : 0.5), score: t.score, color: t.color, cool: rand(0.8, 1.8), flash: 0, ...extra });
}
const later = (delay, fn) => G.queue.push({ t: delay, fn });

const WAVES = [
  () => { // 돌격 편대 (V자)
    const y = rand(150, H - 130);
    for (let i = 0; i < 5; i++) spawn('dart', W + 40 + Math.abs(i - 2) * 45, y + (i - 2) * 38);
  },
  () => { // 물결 편대
    const y = rand(160, H - 150);
    for (let i = 0; i < 5; i++) later(i * 0.32, () => spawn('swoop', W + 30, y, { t: 0 }));
  },
  () => { for (let i = 0; i < 4; i++) later(i * 0.5, () => spawn('chaser', W + 30, rand(90, H - 60))); },
  () => spawn('balloon', W + 40, rand(140, H - 140), { drop: true }),
  () => { // 위아래 협공
    for (let i = 0; i < 4; i++) later(i * 0.3, () => { spawn('dart', W + 30, 90 + i * 22); spawn('dart', W + 30, H - 60 - i * 22); });
  },
  () => spawn('gunship', W + 50, rand(150, H - 150), { drop: true }),
];
function nextWave() {
  const unlocked = Math.min(WAVES.length, 3 + G.stage + Math.floor(G.time / 9));
  WAVES[Math.floor(Math.random() * unlocked)]();
  if (G.stage > 0 && Math.random() < 0.3 * G.stage) later(1, WAVES[0]);
  G.nextWave = rand(2.3, 3.3) - G.stage * 0.3;
}

function bullet(x, y, ang, sp, r = 5, color = '#ff4f6d') {
  G.bullets.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r, color, grazed: false });
}
const aim = e => Math.atan2(G.p.y - e.y, G.p.x - e.x);

function updateEnemy(e, dt) {
  e.t += dt; e.flash -= dt; e.cool -= dt;
  const hard = 1 + G.stage * 0.15;
  switch (e.type) {
    case 'dart': e.x -= 270 * hard * dt; e.y = e.y0 + Math.sin(e.t * 3) * 14; break;
    case 'swoop':
      e.x -= 165 * hard * dt; e.y = clamp(e.y0 + Math.sin(e.t * 2.6) * 90, 70, H - 40);
      if (e.cool < 0 && e.x < W - 20 && e.x > G.p.x + 120) { bullet(e.x - 12, e.y, aim(e), 230 * hard); e.cool = 2; }
      break;
    case 'chaser': {
      e.x -= 220 * hard * dt;
      if (e.x > G.p.x) e.y += clamp(G.p.y - e.y, -120 * dt * hard, 120 * dt * hard);
      break;
    }
    case 'balloon':
      e.x -= 65 * dt; e.y = e.y0 + Math.sin(e.t) * 25;
      if (e.cool < 0 && e.x < W - 30) {
        const n = 10 + G.stage * 2, o = rand(0, TAU);
        for (let i = 0; i < n; i++) bullet(e.x, e.y, o + i / n * TAU, 145 * hard, 5, '#59e8da');
        e.cool = 2.3;
      }
      break;
    case 'gunship':
      if (e.t > 13) e.x -= 200 * dt; else e.x += (W - 170 - e.x) * Math.min(1, 1.6 * dt);
      e.y = e.y0 + Math.sin(e.t * 1.1) * 70;
      if (e.cool < 0 && e.t < 13) {
        const a = aim(e);
        for (let i = -2; i <= 2; i++) bullet(e.x - 30, e.y, a + i * 0.17, 215 * hard, 5, '#b7c6ff');
        e.cool = 1.5;
      }
      break;
    case 'boss': updateBoss(e, dt); break;
  }
}

function spawnBoss() {
  const hp = 190 + G.stage * 90;
  G.boss = { type: 'boss', kind: G.stage, x: W + 130, y: H / 2, r: 62, hp, max: hp, t: 0, cool: 2, spin: 0, shots: 0, flash: 0, score: 5000 + G.stage * 3000, color: ['#ff7a90', '#8fb0ff', '#6ff0d0'][G.stage] };
  G.enemies.push(G.boss);
}
function updateBoss(b, dt) {
  if (b.t < 2.2) { b.x += (W - 170 - b.x) * Math.min(1, 2.4 * dt); return; }
  const rage = b.hp < b.max * 0.4 ? 1.35 : 1, c = b.color;
  b.x = W - 170 + Math.sin(b.t * 0.6) * 35;
  b.y += (H / 2 + Math.sin(b.t * 0.8 * rage) * 140 - b.y) * Math.min(1, 2 * dt);
  if (b.cool > 0) return;
  const phase = (Math.floor(b.t / 5) + b.kind) % 3;
  b.shots++;
  if (phase === 0) { // 조준 부채꼴
    const a = aim(b), n = 3 + b.kind;
    for (let i = -n; i <= n; i++) bullet(b.x - 50, b.y, a + i * 0.15, 220 + b.kind * 15, 6, c);
    b.cool = 1.15 / rage;
  } else if (phase === 1) { // 나선
    const arms = 2 + b.kind;
    b.spin += 0.24;
    for (let i = 0; i < arms; i++) bullet(b.x, b.y, b.spin + i / arms * TAU, 165, 6, c);
    b.cool = 0.12 / rage;
  } else { // 틈이 움직이는 탄막 벽
    const gap = H / 2 + Math.sin(b.shots * 0.9) * 150;
    for (let y = 70; y < H; y += 34) if (Math.abs(y - gap) > 72) bullet(b.x - 30, y, Math.PI, 190 + b.kind * 12, 6, c);
    b.cool = 1.5 / rage;
  }
}

/* ---------- 효과 ---------- */
function burst(x, y, color, n, sp) {
  for (let i = 0; i < n && G.parts.length < 500; i++) {
    const a = rand(0, TAU), v = rand(0.2, 1) * sp, life = rand(0.3, 0.8);
    G.parts.push({ x, y, vx: Math.cos(a) * v - 40, vy: Math.sin(a) * v, life, max: life, r: rand(2, 5), color });
  }
}
function label(x, y, text, color = '#fff') { G.texts.push({ x, y, text, color, life: 0.9 }); }

function damage(e, n) {
  if (e.dead) return;
  if (e.type === 'boss' && e.t < 2.2) return; // 등장 중 무적
  e.hp -= n; e.flash = 0.06;
  if (e.hp > 0) { sfx.hit(); return; }
  e.dead = true;
  G.combo++; G.comboT = 2.5;
  const mult = 1 + Math.min(4, Math.floor(G.combo / 8));
  G.score += e.score * mult;
  label(e.x, e.y, '+' + e.score * mult, mult > 1 ? '#ffe17a' : '#fff');
  if (e.type === 'boss') {
    burst(e.x, e.y, e.color, 120, 480); burst(e.x, e.y, '#fff', 50, 300);
    G.rings.push({ x: e.x, y: e.y, r: 20, sp: 600, life: 0.8, color: '#fff' });
    shake = 18; sfx.bigBoom();
    G.boss = null; G.bullets.length = 0; G.queue.length = 0; G.clearT = 3.5; state = 'clear';
    for (const o of G.enemies) if (!o.dead) { o.dead = true; burst(o.x, o.y, o.color, 14, 200); }
    return;
  }
  const big = e.r > 24;
  burst(e.x, e.y, e.color, big ? 36 : 16, big ? 300 : 210);
  burst(e.x, e.y, '#ffe9b8', big ? 14 : 6, 150);
  shake = Math.max(shake, big ? 6 : 2);
  sfx.boom();
  if (e.drop || Math.random() < 0.06) {
    const p = G.p;
    let kind = 'star';
    if (p.hp < 3 && Math.random() < 0.5) kind = 'heal';
    else if (p.gun < 5) kind = 'gun';
    G.items.push({ kind, x: e.x, y: e.y, t: 0 });
  }
}

function hurtPlayer() {
  const p = G.p;
  if (p.inv > 0 || state !== 'play') return;
  p.hp--; p.inv = 2; p.gun = Math.max(1, p.gun - 1); G.combo = 0;
  shake = 12; sfx.hurt(); burst(p.x, p.y, '#ff9a5c', 26, 260);
  if (p.hp <= 0) { burst(p.x, p.y, '#fff3d6', 60, 380); sfx.bigBoom(); finish('over'); }
}
function finish(s) {
  state = s; G.endT = 0;
  if (G.score > best) { best = G.score; G.newBest = true; saveBest(best); }
}
function addCharge(n) {
  const p = G.p, was = p.charge;
  p.charge = Math.min(100, p.charge + n);
  if (was < 100 && p.charge >= 100) sfx.ready();
}
function firePulse() {
  if (state !== 'play' || G.p.charge < 100) return;
  const p = G.p;
  p.charge = 0; p.inv = Math.max(p.inv, 1.2); shake = 10; sfx.pulse();
  G.rings.push({ x: p.x, y: p.y, r: 10, sp: 1500, life: 0.75, color: '#8ff5ff' });
  for (const b of G.bullets) { burst(b.x, b.y, '#8ff5ff', 2, 80); G.score += 10; }
  G.bullets.length = 0;
  for (const e of G.enemies) if (e.x < W + 20) damage(e, e.type === 'boss' ? 25 : 14);
}

/* ---------- 갱신 ---------- */
function shoot(p) {
  const s = (dy, ang, dmg = 1) => G.shots.push({ x: p.x + 26, y: p.y + dy, vx: Math.cos(ang) * 820, vy: Math.sin(ang) * 820, dmg });
  switch (p.gun) {
    case 1: s(0, 0, 1.2); break;
    case 2: s(-7, 0); s(7, 0); break;
    case 3: s(0, 0, 1.2); s(-6, -0.12); s(6, 0.12); break;
    case 4: s(-6, 0); s(6, 0); s(-8, -0.14); s(8, 0.14); break;
    default: s(0, 0, 1.4); s(-8, -0.05); s(8, 0.05); s(-10, -0.2); s(10, 0.2);
  }
  sfx.shot();
}

function update(dt) {
  clock += dt;
  shake = Math.max(0, shake - dt * 30);
  if (!G || state === 'title' || state === 'pause') return;
  updateEffects(dt);
  if (state === 'over' || state === 'win') { G.endT += dt; return; }

  const p = G.p;
  G.banner -= dt; G.warn -= dt; p.inv -= dt; p.cool -= dt;
  if ((G.comboT -= dt) <= 0) G.combo = 0;

  // 이동
  const held = (...c) => c.some(k => keys.has(k));
  let dx = held('ArrowRight', 'KeyD') - held('ArrowLeft', 'KeyA');
  let dy = held('ArrowDown', 'KeyS') - held('ArrowUp', 'KeyW');
  const oldY = p.y;
  if (dx || dy) {
    const l = Math.hypot(dx, dy);
    p.x += dx / l * 340 * dt; p.y += dy / l * 340 * dt;
  } else if (mouseAim) {
    const mx = mouseAim.x - p.x, my = mouseAim.y - p.y, l = Math.hypot(mx, my), m = Math.min(l, 480 * dt);
    if (l > 1) { p.x += mx / l * m; p.y += my / l * m; }
  }
  p.x = clamp(p.x, 30, W - 60); p.y = clamp(p.y, 60, H - 30);
  const tiltTo = touch.id !== null ? 0 : clamp((p.y - oldY) / dt / 340, -1, 1);
  p.tilt += (tiltTo - p.tilt) * Math.min(1, 10 * dt);

  if (p.cool <= 0 && state === 'play' && (keys.has('Space') || keys.has('KeyZ') || mouseFire || touch.id !== null)) { shoot(p); p.cool = 0.125; }
  if (Math.random() < 0.7) G.parts.push({ x: p.x - 28, y: p.y + rand(-2, 2), vx: -190, vy: rand(-14, 14), life: 0.25, max: 0.25, r: 4, color: '#ffc36b' });

  // 진행
  if (state === 'clear') {
    if ((G.clearT -= dt) <= 0) {
      G.score += p.hp * 500;
      if (G.stage === STAGES.length - 1) { finish('win'); return; }
      G.stage++; G.time = 0; G.nextWave = 3; G.banner = 3;
      p.hp = Math.min(5, p.hp + 1); p.inv = 2; state = 'play';
    }
  } else if (!G.boss) {
    G.time += dt;
    for (const q of G.queue) q.t -= dt;
    const due = G.queue.filter(q => q.t <= 0);
    G.queue = G.queue.filter(q => q.t > 0);
    for (const q of due) q.fn();
    if (G.time < STAGE_TIME) { if ((G.nextWave -= dt) <= 0) nextWave(); }
    else if (!G.queue.length && (!G.enemies.length || G.time > STAGE_TIME + 8)) { spawnBoss(); G.warn = 2.4; sfx.alarm(); }
  }

  for (const e of G.enemies) updateEnemy(e, dt);

  // 아군 탄
  for (const s of G.shots) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.x > W + 20) { s.dead = true; continue; }
    for (const e of G.enemies) {
      if (e.dead || (s.x - e.x) ** 2 + (s.y - e.y) ** 2 > (e.r + 6) ** 2) continue;
      s.dead = true; burst(s.x, s.y, '#fff2b0', 2, 110); damage(e, s.dmg);
      break;
    }
  }
  if (state === 'play') for (const e of G.enemies) {
    if (!e.dead && dist2(e, p) < (e.r * 0.8 + p.r) ** 2) { hurtPlayer(); if (e.type !== 'boss') damage(e, 10); }
  }

  // 적 탄: 스치면 충격파 충전
  for (const b of G.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -20 || b.x > W + 80 || b.y < -20 || b.y > H + 20) { b.dead = true; continue; }
    const d = dist2(b, p);
    if (d < (b.r + p.r) ** 2) { if (p.inv <= 0) { b.dead = true; hurtPlayer(); } }
    else if (!b.grazed && p.inv <= 0 && d < 38 ** 2) {
      b.grazed = true; G.score += 20; addCharge(6); sfx.graze(); burst(b.x, b.y, '#8ff5ff', 4, 90);
    }
  }

  for (const it of G.items) {
    it.t += dt; it.x -= 70 * dt; it.y += Math.sin(it.t * 3) * 30 * dt;
    if (dist2(it, p) < 110 ** 2) { it.x += (p.x - it.x) * 5 * dt; it.y += (p.y - it.y) * 5 * dt; }
    if (dist2(it, p) < 34 ** 2) {
      it.dead = true; sfx.item();
      if (it.kind === 'gun') { p.gun = Math.min(5, p.gun + 1); label(p.x, p.y - 30, '화력 강화', '#ffe17a'); }
      else if (it.kind === 'heal') { p.hp = Math.min(5, p.hp + 1); label(p.x, p.y - 30, '수리 완료', '#8dffb0'); }
      else { G.score += 1000; addCharge(25); label(p.x, p.y - 30, '+1000', '#8ff5ff'); }
    }
  }

  const alive = o => !o.dead;
  G.shots = G.shots.filter(alive);
  G.bullets = G.bullets.filter(alive);
  G.enemies = G.enemies.filter(e => !e.dead && e.x > -60);
  G.items = G.items.filter(i => !i.dead && i.x > -30);
}
function updateEffects(dt) {
  for (const q of G.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
  for (const r of G.rings) { r.r += r.sp * dt; r.life -= dt; }
  for (const t of G.texts) { t.y -= 40 * dt; t.life -= dt; }
  G.parts = G.parts.filter(q => q.life > 0);
  G.rings = G.rings.filter(r => r.life > 0);
  G.texts = G.texts.filter(t => t.life > 0);
}

/* ---------- 그리기 ---------- */
function poly(points, fill) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function disc(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
function oval(x, y, a, b, fill) { ctx.beginPath(); ctx.ellipse(x, y, a, b, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
function text(s, x, y, size, color = '#fff', align = 'center', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}

const stars = Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, H * 0.6), r: rand(0.5, 1.6) }));
const clouds = Array.from({ length: 12 }, () => ({ x: rand(0, W + 300), y: rand(70, H - 100), s: rand(0.5, 1.4) }));

function drawBackground() {
  const st = STAGES[G ? G.stage : 0];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, st.sky[0]); g.addColorStop(0.55, st.sky[1]); g.addColorStop(1, st.sky[2]);
  ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.globalAlpha = G && G.stage === 1 ? 0.9 : 0.25;
  for (const s of stars) disc(((s.x - clock * 4) % W + W) % W, s.y, s.r, '#fff');
  ctx.globalAlpha = 0.18; disc(690, 300, 120, st.sun);
  ctx.globalAlpha = 0.9; disc(690, 300, 76, st.sun);
  ctx.globalAlpha = 1;
  st.hills.forEach((c, i) => {
    const off = clock * [18, 48, 110][i], base = H - 120 + i * 44, amp = 46 - i * 10, f = 0.006 + i * 0.002;
    ctx.beginPath(); ctx.moveTo(-20, H + 20);
    for (let x = -20; x <= W + 20; x += 12) {
      const u = (x + off) * f;
      ctx.lineTo(x, base - Math.abs(Math.sin(u)) * amp - Math.sin(u * 2.7 + i) * 10);
    }
    ctx.lineTo(W + 20, H + 20); ctx.fillStyle = c; ctx.fill();
  });
  ctx.globalAlpha = 0.13;
  for (const c of clouds) {
    const span = W + 400, x = ((c.x - clock * 70 * c.s) % span + span) % span - 200;
    ctx.beginPath();
    ctx.ellipse(x, c.y, 80 * c.s, 13 * c.s, 0, 0, TAU);
    ctx.ellipse(x - 18 * c.s, c.y - 10 * c.s, 34 * c.s, 14 * c.s, 0, 0, TAU);
    ctx.fillStyle = '#fff'; ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlane(x, y, tilt, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt * 0.22); ctx.scale(scale, scale);
  const f = 14 + Math.sin(clock * 60) * 4;
  poly([-24, -4, -26 - f, 0, -24, 4], '#ffd27a');
  poly([-22, -3, -36, -18, -24, -18, -8, -4], '#d94f3d');           // 꼬리날개
  poly([6, -3, -10, -16 + tilt * 8, -18, -16 + tilt * 8, -8, -2], '#c9c3d6'); // 뒤쪽 날개
  poly([32, 1, 16, -8, -20, -7, -26, 0, -18, 7, 14, 7], '#f7f3ea');  // 동체
  poly([32, 1, 14, 7, -18, 7, -26, 0], '#d5cfdf');
  poly([17, -7, 6, -12, -4, -8], '#3f7fb5');                        // 조종석
  poly([10, 3, -14, 20 + tilt * 6, -24, 20 + tilt * 6, -10, 3], '#d94f3d');   // 앞쪽 날개
  ctx.restore();
}

function drawEnemy(e) {
  ctx.save(); ctx.translate(e.x, e.y);
  const c = e.flash > 0 ? '#fff' : e.color, dark = e.flash > 0 ? '#fff' : '#2a1838';
  switch (e.type) {
    case 'dart':
      poly([-20, 0, 12, -11, 6, 0, 12, 11], c); poly([-6, 0, 10, -4, 10, 4], dark); break;
    case 'swoop':
      ctx.rotate(Math.cos(e.t * 2.6) * -0.4);
      poly([-18, 0, 4, -20, 16, -20, 8, 0, 16, 20, 4, 20], c); disc(-2, 0, 6, dark); break;
    case 'chaser':
      ctx.save(); ctx.rotate(e.t * 8);
      for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); poly([0, -5, 19, -2, 14, 6], c); }
      ctx.restore(); disc(0, 0, 8, dark); disc(0, 0, 3.5, c); break;
    case 'balloon':
      oval(0, -4, 30, 25, c); ctx.globalAlpha = 0.3; oval(0, -4, 11, 25, dark); ctx.globalAlpha = 1;
      ctx.fillStyle = dark; ctx.fillRect(-11, 20, 22, 11); break;
    case 'gunship':
      poly([-40, 4, -14, -16, 30, -14, 42, -26, 42, 14, 14, 20, -22, 18], c);
      poly([-24, 2, -8, -10, 4, -10, 0, 2], dark);
      ctx.fillStyle = dark; ctx.fillRect(-42, 9, 28, 6); break;
    case 'boss': drawBoss(e, c, dark); break;
  }
  ctx.restore();
}
function drawBoss(b, c, dark) {
  const s = Math.sin(b.t * 3);
  if (b.kind === 0) { // 가오리
    poly([-80, 0, -10, -30, 30, -96 + s * 14, 50, -20, 110, 0, 50, 20, 30, 96 - s * 14, -10, 30], c);
    oval(0, 0, 46, 24, dark);
  } else if (b.kind === 1) { // 올빼미
    poly([-40, -50, -20, -86, 0, -56, 30, -60, 78, -100 + s * 10, 80, 100 - s * 10, 30, 60, 0, 56, -20, 86, -40, 50, -76, 0], c);
    disc(-14, -24, 20, dark); disc(-14, 24, 20, dark); disc(-18, -24, 9, '#ffd75e'); disc(-18, 24, 9, '#ffd75e');
  } else { // 해파리
    ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.strokeStyle = c;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(20, i * 16);
      ctx.quadraticCurveTo(60, i * 22 + Math.sin(b.t * 4 + i) * 22, 108, i * 26 + Math.cos(b.t * 3 + i) * 18);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(10, 0, 78, 68, 0, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    disc(-18, 0, 30, dark);
  }
  disc(-16, 0, 11 + s * 3, b.hp < b.max * 0.4 ? '#ff3b4f' : '#fff4c7');
}

function drawWorld() {
  for (const q of G.parts) { ctx.globalAlpha = clamp(q.life / q.max, 0, 1); disc(q.x, q.y, q.r * (0.4 + 0.6 * q.life / q.max), q.color); }
  ctx.globalAlpha = 1;
  for (const it of G.items) {
    const c = { gun: '#ffd75e', heal: '#7dffa6', star: '#8ff5ff' }[it.kind];
    ctx.globalAlpha = 0.3; disc(it.x, it.y, 22 + Math.sin(it.t * 6) * 3, c); ctx.globalAlpha = 1;
    disc(it.x, it.y, 15, '#231534');
    text({ gun: '▲', heal: '✚', star: '★' }[it.kind], it.x, it.y + 1, 17, c);
  }
  for (const e of G.enemies) drawEnemy(e);
  ctx.fillStyle = '#fff6bd';
  for (const s of G.shots) ctx.fillRect(s.x - 11, s.y - 2, 22, 4);
  const p = G.p;
  if (state !== 'over' && (p.inv <= 0 || Math.floor(clock * 14) % 2)) {
    drawPlane(p.x, p.y, p.tilt);
    disc(p.x, p.y, 3.5, '#8ff5ff'); // 실제 피격 지점
  }
  for (const b of G.bullets) { disc(b.x, b.y, b.r + 3, b.color); disc(b.x, b.y, b.r - 1, '#fff'); }
  for (const r of G.rings) {
    ctx.globalAlpha = clamp(r.life, 0, 1); ctx.lineWidth = 8; ctx.strokeStyle = r.color;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
  }
  for (const t of G.texts) { ctx.globalAlpha = clamp(t.life * 2, 0, 1); text(t.text, t.x, t.y, 16, t.color); }
  ctx.globalAlpha = 1;
}

function bar(x, y, w, h, v, color) {
  ctx.fillStyle = 'rgba(15,8,30,.6)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(v, 0, 1), h);
}
function drawHUD() {
  const p = G.p;
  for (let i = 0; i < 5; i++) poly([20 + i * 24, 18, 38 + i * 24, 27, 20 + i * 24, 36], i < p.hp ? '#ff6b57' : 'rgba(15,8,30,.45)');
  text('화력 ' + p.gun + (p.gun === 5 ? ' 최대' : ''), 152, 27, 15, '#ffe17a', 'left');
  const full = p.charge >= 100;
  bar(20, 46, 180, 9, p.charge / 100, full && Math.floor(clock * 6) % 2 ? '#fff' : '#8ff5ff');
  text(full ? (touchMode ? '충격파 준비' : '충격파 준비 [X]') : '충격파', 208, 51, 13, full ? '#fff' : '#cfe9f5', 'left');
  text(G.score.toLocaleString(), W - 68, 27, 24, '#fff', 'right', 800);
  if (G.combo >= 3) text(`${G.combo}연속 ×${1 + Math.min(4, Math.floor(G.combo / 8))}`, W - 68, 53, 15, '#ffe17a', 'right');
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - 41, 25, 5, 18); ctx.fillRect(W - 31, 25, 5, 18);
  if (muted) text('음소거', W - 34, 60, 12, '#fff');
  if (G.boss) {
    text(STAGES[G.boss.kind].boss, W / 2, 24, 16);
    bar(W / 2 - 170, 37, 340, 8, G.boss.hp / G.boss.max, G.boss.color);
  } else if (state === 'play') {
    bar(W / 2 - 90, 26, 180, 4, G.time / STAGE_TIME, 'rgba(255,255,255,.75)');
  }
  if (touchMode) {
    ctx.globalAlpha = full ? 0.95 : 0.35;
    disc(PULSE_BTN.x, PULSE_BTN.y, PULSE_BTN.r, '#153a55');
    text('충격파', PULSE_BTN.x, PULSE_BTN.y, 17, '#8ff5ff'); ctx.globalAlpha = 1;
  }
  if (G.warn > 0 && Math.floor(G.warn * 5) % 2 === 0) {
    ctx.fillStyle = 'rgba(150,10,40,.6)'; ctx.fillRect(-20, H / 2 - 45, W + 40, 90);
    text('경고 — 거대 적 접근', W / 2, H / 2, 38);
  } else if (G.banner > 0) {
    ctx.globalAlpha = clamp(G.banner, 0, 1);
    text(`스테이지 ${G.stage + 1}`, W / 2, H / 2 - 64, 20, '#ffe9c4');
    text(STAGES[G.stage].name, W / 2, H / 2 - 26, 42, '#fff', 'center', 800);
    ctx.globalAlpha = 1;
  }
  if (state === 'clear') text('격추 성공!', W / 2, H / 2 - 20, 48, '#ffe17a', 'center', 800);
}

function overlay(a) { ctx.fillStyle = `rgba(16,8,32,${a})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
function drawTitle() {
  overlay(0.28);
  drawPlane(W / 2, 128 + Math.sin(clock * 2) * 9, Math.cos(clock * 2) * 0.3, 2.4);
  text('노을 편대', W / 2, 232, 68, '#fff6e2', 'center', 900);
  text('적탄을 아슬아슬하게 스치면 충격파가 충전됩니다', W / 2, 290, 18, '#ffe0b0', 'center', 600);
  text('방향키 · WASD  이동      스페이스  발사      X · Shift  충격파', W / 2, 352, 17, '#fff', 'center', 600);
  text('마우스  이동 · 좌클릭 발사 · 우클릭 충격파      터치  드래그로 이동 · 자동 발사', W / 2, 382, 15, '#e6d7ee', 'center', 500);
  text('P  일시정지      M  음소거', W / 2, 410, 15, '#e6d7ee', 'center', 500);
  ctx.globalAlpha = 0.65 + Math.sin(clock * 4) * 0.35;
  text('스페이스 또는 클릭으로 출격', W / 2, 466, 24, '#ffe17a'); ctx.globalAlpha = 1;
  if (best) text('최고 점수 ' + best.toLocaleString(), W / 2, 506, 16);
}
function drawEnd(win) {
  overlay(clamp(G.endT, 0, 0.65));
  text(win ? '하늘을 지켜냈다!' : '추락했습니다', W / 2, 180, 54, win ? '#ffe17a' : '#ff9a8c', 'center', 900);
  text(G.score.toLocaleString() + '점', W / 2, 260, 40);
  text(G.newBest ? '최고 기록 갱신!' : '최고 점수 ' + best.toLocaleString(), W / 2, 310, 20, G.newBest ? '#8ff5ff' : '#e6d7ee');
  if (G.endT > 0.8) text('Enter 또는 클릭으로 다시 출격', W / 2, 390, 22, '#ffe17a');
}

function draw() {
  ctx.setTransform(view, 0, 0, view, 0, 0);
  const s = state === 'pause' ? 0 : shake;
  ctx.translate(rand(-s, s) * 0.5, rand(-s, s) * 0.5);
  drawBackground();
  if (state === 'title') { drawTitle(); return; }
  drawWorld();
  ctx.setTransform(view, 0, 0, view, 0, 0);
  drawHUD();
  if (state === 'pause') {
    overlay(0.6);
    text('일시정지', W / 2, H / 2 - 24, 50, '#fff', 'center', 900);
    text('P 또는 클릭으로 계속', W / 2, H / 2 + 34, 20, '#ffe17a');
  }
  if (state === 'over') drawEnd(false);
  if (state === 'win') drawEnd(true);
}

/* ---------- 루프 (모니터 주사율과 무관한 고정 간격) ---------- */
let last = 0, acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
