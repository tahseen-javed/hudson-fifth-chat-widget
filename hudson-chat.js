/*! Hudson & Fifth Realty chat widget 1.0.0
 *  One <script> tag, no dependencies. Talks only to the chat proxy (data-api); it never holds a Vapi key.
 *  <script src=".../hudson-chat.js" data-api="https://your-proxy.workers.dev" defer></script>
 *  Options (data-*): api, theme (auto|light|dark), position (right|left), open (true), title, subtitle, greeting, placeholder,
 *  phone, email, privacy-url, accent, brand, teaser (true|false), teaser-text, bottom, side, z, chips (JSON).
 */
(function () {
  'use strict';
  if (window.HudsonChat && window.HudsonChat.version) return;

  var BAKED_API = '';
  var script = document.currentScript || (function () { var s = document.querySelectorAll('script[src*="hudson-chat"]'); return s[s.length - 1] || null; })();
  var D = (script && script.dataset) || {};
  var truthy = function (v, dflt) { return v == null || v === '' ? dflt : !/^(false|0|no|off)$/i.test(v); };
  var DEFAULT_GREETING = "Hi, my name is John. I'm with Hudson and Fifth Realty. How can I help?";
  var CFG = {
    api: String(D.api || (BAKED_API.indexOf('__') === 0 ? '' : BAKED_API)).replace(/\/+$/, ''),
    theme: /^(light|dark)$/.test(D.theme) ? D.theme : 'auto',
    position: D.position === 'left' ? 'left' : 'right',
    autoOpen: D.open != null && truthy(D.open, false),
    title: D.title || 'Hudson & Fifth',
    subtitle: D.subtitle || 'John · AI assistant',
    greeting: D.greeting || DEFAULT_GREETING,
    placeholder: D.placeholder || 'Type your message…',
    phone: D.phone || '',
    email: D.email || '',
    privacyUrl: /^https?:\/\//i.test(D.privacyUrl || '') ? D.privacyUrl : '',
    accent: /^#[0-9a-f]{6}$/i.test(D.accent || '') ? D.accent : '',
    brand: /^#[0-9a-f]{6}$/i.test(D.brand || '') ? D.brand : '',
    teaser: truthy(D.teaser, true),
    teaserText: D.teaserText || 'Looking to rent, buy or sell in NYC? Ask John.',
    bottom: parseInt(D.bottom, 10) || 20,
    side: parseInt(D.side, 10) || 20,
    z: parseInt(D.z, 10) || 2147483000,
    maxChars: 800,
    chips: [
      { label: 'Rent', text: "I'm looking to rent." },
      { label: 'Buy', text: "I'm looking to buy." },
      { label: 'Sell', text: "I'd like to sell my property." },
      { label: 'Book a viewing', text: "I'd like to book a viewing." }
    ]
  };
  try {
    var custom = D.chips ? JSON.parse(D.chips) : null;
    if (Array.isArray(custom) && custom.length) CFG.chips = custom.filter(function (x) { return x && x.label && x.text; }).slice(0, 6);
  } catch (e) { /* keep the default chips */ }

  var KEY = 'hfchat:v1';
  var TTL_MS = 3 * 3600 * 1000;
  var MOBILE_Q = '(max-width: 480px)';

  // ------------------------------------------------------------------ small helpers
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(paths, size) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 22); s.setAttribute('height', size || 22);
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  var ICON = {
    chat: ['M21 11.5a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.6-.8L3 21l1.9-4.9A8.2 8.2 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z'],
    close: ['M18 6 6 18', 'M6 6l12 12'],
    chevron: ['m6 9 6 6 6-6'],
    send: ['M5 12h14', 'M13 6l6 6-6 6'],
    refresh: ['M20 11a8 8 0 0 0-14.9-3', 'M4 5v4h4', 'M4 13a8 8 0 0 0 14.9 3', 'M20 19v-4h-4'],
    down: ['M12 5v14', 'M6 13l6 6 6-6']
  };
  function now() { return Date.now(); }
  function store() { try { return window.sessionStorage; } catch (e) { return null; } }
  function emit(type, detail) { try { window.dispatchEvent(new CustomEvent('hudson-chat', { detail: Object.assign({ type: type }, detail || {}) })); } catch (e) { /* very old browser */ } }

  // ------------------------------------------------------------------ text -> safe DOM (bold, bullet lists, links, emails, phones)
  var TOKEN = /(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>"']+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)|((?:\(\d{3}\)|\b\d{3})[ .-]?\d{3}[ .-]\d{4}\b)/g;
  function link(parent, href, label) {
    var a = h('a', { href: href, target: href.indexOf('http') === 0 ? '_blank' : null, rel: 'noopener noreferrer' });
    a.textContent = label; parent.appendChild(a);
  }
  function inline(parent, text) {
    var last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tok = m[0], tail = '';
      if (m[1]) { var b = h('strong'); b.textContent = tok.slice(2, -2); parent.appendChild(b); }
      else if (m[2]) { var trail = /[.,;:!?)\]]+$/.exec(tok); if (trail) { tail = trail[0]; tok = tok.slice(0, -tail.length); } link(parent, tok, tok); }
      else if (m[3]) link(parent, 'mailto:' + tok, tok);
      else if (m[4]) link(parent, 'tel:' + tok.replace(/[^\d]/g, ''), tok);
      if (tail) parent.appendChild(document.createTextNode(tail));
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  var BULLET = /^\s*([-*•])\s+/;
  function renderInto(el, text) {
    el.textContent = '';
    var para = null, list = null;
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (!line.trim()) { para = null; list = null; return; }
      if (BULLET.test(line)) {
        para = null;
        if (!list) { list = h('ul'); el.appendChild(list); }
        var li = h('li'); inline(li, line.replace(BULLET, '')); list.appendChild(li);
      } else {
        list = null;
        if (!para) { para = h('p'); el.appendChild(para); } else para.appendChild(h('br'));
        inline(para, line.trim());
      }
    });
  }

  // ------------------------------------------------------------------ styles
  var CSS = [
    ':host{all:initial}*{box-sizing:border-box}',
    '.hf{all:initial;display:block;--navy:#0b1b33;--navy2:#13294b;--gold:#c8a24a;--gold2:#e3c981;--gtext:#7a5a12;--bg:#fff;--bg2:#f6f3ea;--line:#e4dfd0;--ink:#14213d;--muted:#5b6577;--ba:#f3efe4;--bai:#14213d;--bu:#0b1b33;--bui:#fff;--focus:#0b1b33;--focus2:#f3d98b;--chip:#9a7a2a;--shadow:0 24px 64px rgba(11,27,51,.30),0 4px 16px rgba(11,27,51,.16);',
    'position:fixed;z-index:var(--z);bottom:var(--oy);right:var(--ox);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}',
    '.hf[data-pos=left]{right:auto;left:var(--ox)}',
    '.hf[data-scheme=dark]{--bg:#0f1a2e;--bg2:#0b1426;--line:#24344f;--ink:#eaf0fa;--muted:#9fb0cc;--ba:#18263f;--bai:#eaf0fa;--bu:#c8a24a;--bui:#0b1b33;--focus:#f3d98b;--chip:#c8a24a;--gtext:#e3c981;--shadow:0 24px 64px rgba(0,0,0,.55),0 4px 16px rgba(0,0,0,.35)}',
    '.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '[hidden]{display:none!important}',
    'button{font:inherit;color:inherit;cursor:pointer;margin:0}',
    'button:focus-visible,a:focus-visible,.log:focus-visible{outline:3px solid var(--focus);outline-offset:2px}',
    '.head button:focus-visible,.launcher:focus-visible{outline-color:var(--focus2)}',
    /* launcher */
    '.launcher{position:relative;width:62px;height:62px;border-radius:50%;border:2px solid var(--gold);background:radial-gradient(120% 120% at 30% 20%,var(--navy2),var(--navy));color:#fff;display:grid;place-items:center;box-shadow:0 10px 28px rgba(11,27,51,.38),0 0 0 0 rgba(200,162,74,.55);transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}',
    '.launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(11,27,51,.42),0 0 0 6px rgba(200,162,74,.22)}',
    '.launcher:active{transform:scale(.96)}',
    '.launcher .ic{grid-area:1/1;display:grid;transition:transform .25s,opacity .2s}.launcher .ic-x{opacity:0;transform:rotate(-80deg) scale(.6)}',
    '.hf.open .launcher .ic-chat{opacity:0;transform:rotate(80deg) scale(.6)}.hf.open .launcher .ic-x{opacity:1;transform:none}',
    '.hf.pulse .launcher{animation:pulse 2.4s ease-out 1.2s 3}',
    '@keyframes pulse{0%{box-shadow:0 10px 28px rgba(11,27,51,.38),0 0 0 0 rgba(200,162,74,.6)}70%{box-shadow:0 10px 28px rgba(11,27,51,.38),0 0 0 18px rgba(200,162,74,0)}100%{box-shadow:0 10px 28px rgba(11,27,51,.38),0 0 0 0 rgba(200,162,74,0)}}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#b3261e;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;border:2px solid #fff}',
    /* teaser */
    '.teaser{position:absolute;bottom:76px;right:0;width:max-content;max-width:min(270px,calc(100vw - 2*var(--ox)));background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:16px 16px 4px 16px;box-shadow:var(--shadow);padding:12px 38px 12px 14px;font-size:14px;animation:rise .35s cubic-bezier(.2,.8,.2,1)}',
    '.hf[data-pos=left] .teaser{right:auto;left:0;border-radius:16px 16px 16px 4px}',
    '.teaser .t-open{display:block;border:0;background:none;padding:0;text-align:left;color:inherit;font-size:14px;line-height:1.4}.teaser .t-open:hover{text-decoration:underline}',
    '.teaser .t-x{position:absolute;top:2px;right:2px;width:36px;height:36px;border:0;background:none;color:var(--muted);border-radius:50%;display:grid;place-items:center}',
    '.teaser .t-x:hover{background:var(--bg2)}',
    /* panel */
    '.panel{position:absolute;bottom:78px;right:0;width:392px;max-width:calc(100vw - 2*var(--ox));height:640px;max-height:calc(100dvh - 118px - var(--oy));display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);overflow:hidden;transform-origin:bottom right;opacity:0;visibility:hidden;transform:translateY(14px) scale(.96);transition:opacity .2s ease,transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s linear .26s}',
    '.hf[data-pos=left] .panel{right:auto;left:0;transform-origin:bottom left}',
    '.hf.open .panel{opacity:1;visibility:visible;transform:none;transition:opacity .2s ease,transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s}',
    /* header */
    '.head{display:flex;align-items:center;gap:10px;padding:14px 10px 14px 16px;background:linear-gradient(135deg,var(--navy2),var(--navy));color:#fff;border-bottom:3px solid var(--gold);flex:none}',
    '.avatar{flex:none;width:40px;height:40px;border-radius:50%;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#0b1b33;display:grid;place-items:center;font:700 19px/1 Georgia,"Times New Roman",serif;position:relative}',
    '.avatar::after{content:"";position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#35c27a;border:2px solid var(--navy)}',
    '.titles{flex:1;min-width:0}.title{margin:0;font:600 16px/1.2 Georgia,"Times New Roman",serif;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sub{margin:3px 0 0;font-size:12.5px;color:#e3c981;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ibtn{flex:none;min-width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 10px;font-size:13px;font-weight:600;transition:background .15s}',
    '.ibtn:hover{background:rgba(255,255,255,.14)}',
    /* banners */
    '.banner{flex:none;padding:8px 16px;font-size:13px;background:#fff4d6;color:#5b4300;border-bottom:1px solid #ecd9a0}.hf[data-scheme=dark] .banner{background:#3a2e10;color:#f6e3a8;border-color:#5a4718}',
    '.confirm{flex:none;padding:12px 16px;background:var(--bg2);border-bottom:1px solid var(--line);font-size:14px}',
    '.confirm p{margin:0 0 10px}.btns{display:flex;gap:8px;flex-wrap:wrap}',
    '.btn{min-height:44px;padding:0 16px;border-radius:12px;border:1.5px solid var(--chip);background:var(--bg);color:var(--ink);font-weight:600}',
    '.btn.primary{background:var(--navy);border-color:var(--navy);color:#fff}.hf[data-scheme=dark] .btn.primary{background:var(--gold);border-color:var(--gold);color:#0b1b33}',
    '.btn:hover{filter:brightness(.96)}',
    /* messages */
    '.log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px 14px 8px;display:flex;flex-direction:column;gap:10px;background:var(--bg);scroll-behavior:smooth}',
    '.row{display:flex;gap:8px;align-items:flex-end;animation:rise .24s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '.row.u{justify-content:flex-end}.row.n{justify-content:center}',
    '.mini{flex:none;width:28px;height:28px;border-radius:50%;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#0b1b33;display:grid;place-items:center;font:700 14px/1 Georgia,serif}',
    '.mini.ghost{visibility:hidden}',
    '.bubble{max-width:calc(100% - 36px);padding:10px 14px;border-radius:18px;overflow-wrap:anywhere;word-break:break-word}',
    '.row.a .bubble{background:var(--ba);color:var(--bai);border-bottom-left-radius:6px}',
    '.row.u .bubble{background:var(--bu);color:var(--bui);border-bottom-right-radius:6px;max-width:86%}',
    '.bubble p{margin:0}.bubble p+p,.bubble ul+p,.bubble p+ul{margin-top:8px}.bubble ul{margin:0;padding-left:20px}.bubble li{margin:3px 0}',
    '.bubble a{color:var(--gtext);font-weight:600;text-underline-offset:2px}.row.u .bubble a{color:inherit}',
    '.bubble.err{background:#fdecea;color:#7a1c12;border:1px solid #f3c1bb}.hf[data-scheme=dark] .bubble.err{background:#3b1a17;color:#ffd9d4;border-color:#6d2e27}',
    '.bubble.err a{color:inherit}.bubble.err .btn{margin-top:10px;min-height:44px;font-size:14px}',
    '.bubble.note{background:transparent;color:var(--muted);font-size:13px;text-align:center;max-width:100%;padding:2px 8px}',
    '.caret::after{content:"";display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-2px;background:var(--gold);animation:blink 1s steps(1) infinite}',
    '@keyframes blink{50%{opacity:0}}',
    '.dots{display:inline-flex;gap:5px;align-items:center;height:20px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:dot 1.2s infinite ease-in-out}',
    '.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}',
    '.jump{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);min-height:44px;padding:0 16px;border-radius:22px;border:1.5px solid var(--chip);background:var(--bg);color:var(--ink);box-shadow:var(--shadow);font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}',
    /* quick replies */
    '.chips{flex:none;display:flex;flex-wrap:wrap;gap:8px;padding:4px 14px 10px;background:var(--bg)}',
    '.chip{min-height:44px;padding:0 16px;border-radius:22px;border:1.5px solid var(--chip);background:var(--bg);color:var(--ink);font-weight:600;font-size:14px;transition:background .15s,transform .15s}',
    '.chip:hover{background:var(--ba);transform:translateY(-1px)}.chip:active{transform:scale(.97)}',
    /* composer */
    '.composer{flex:none;display:flex;align-items:flex-end;gap:8px;margin:0;padding:10px 12px;border-top:1px solid var(--line);background:var(--bg)}',
    '.field{flex:1;display:flex;align-items:flex-end;border:1.5px solid var(--line);border-radius:22px;background:var(--bg2);padding:4px 10px 4px 14px;transition:border-color .15s,box-shadow .15s}',
    '.field:focus-within{border-color:var(--chip);box-shadow:0 0 0 3px rgba(200,162,74,.30)}',
    'textarea{flex:1;border:0;outline:0;background:transparent;color:var(--ink);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;resize:none;max-height:120px;min-height:36px;padding:7px 0;margin:0}',
    'textarea::placeholder{color:var(--muted);opacity:1}',
    '.send{flex:none;width:44px;height:44px;border-radius:50%;border:0;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#0b1b33;display:grid;place-items:center;transition:transform .15s,opacity .15s}',
    '.send:hover:not(:disabled){transform:scale(1.06)}.send:active:not(:disabled){transform:scale(.95)}.send:disabled{opacity:.45;cursor:default}',
    '.send:focus-visible{outline:3px solid var(--focus);outline-offset:2px}',
    '.count{font-size:12px;color:var(--muted);padding:0 0 8px 6px;align-self:flex-end}',
    '.notice{flex:none;margin:0;padding:6px 16px 10px;font-size:12px;line-height:1.35;color:var(--muted);text-align:center;background:var(--bg)}',
    '.notice a{color:var(--gtext);font-weight:600}',
    /* small screens: full screen */
    '@media (max-width:480px){',
    '.panel{position:fixed;left:0;right:0;top:var(--vvtop,0px);bottom:auto;width:auto;max-width:none;height:var(--vvh,100dvh);max-height:none;border-radius:0;border:0;transform:translateY(24px)}',
    '.hf[data-pos=left] .panel{left:0}',
    '.hf.open .launcher{display:none}',
    '.head{padding-top:calc(14px + env(safe-area-inset-top,0px))}.composer{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}.notice{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}',
    '@media (forced-colors:active){.bubble,.chip,.btn,.field,.panel,.launcher{border:1px solid CanvasText}.send{border:1px solid ButtonText}}'
  ].join('\n');

  // ------------------------------------------------------------------ state
  var state = { open: false, sid: '', msgs: [], busy: false, unread: 0, abort: null, lastText: '', chipsDone: false, renewed: false };
  var els = {};
  var mq = window.matchMedia ? window.matchMedia(MOBILE_Q) : { matches: false };
  var scrollLock = null;
  var typingRow = null;

  function persist() {
    var s = store(); if (!s) return;
    try { s.setItem(KEY, JSON.stringify({ v: 1, at: now(), sid: state.sid, open: state.open, chipsDone: state.chipsDone, msgs: state.msgs.slice(-60) })); } catch (e) { /* storage full or blocked */ }
  }
  function restore() {
    var s = store(); if (!s) return false;
    try {
      var d = JSON.parse(s.getItem(KEY) || 'null');
      if (!d || d.v !== 1 || now() - d.at > TTL_MS) { s.removeItem(KEY); return false; }
      state.sid = d.sid || ''; state.msgs = Array.isArray(d.msgs) ? d.msgs : []; state.chipsDone = !!d.chipsDone; state.open = !!d.open;
      return true;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ build the DOM
  function build() {
    var host = h('hudson-chat', { id: 'hudson-chat-host' });          // an unknown tag name: generic page rules like "div{...}" do not match it
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    try {
      var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS);       // constructable stylesheet: works under strict style-src CSPs
      root.adoptedStyleSheets = [sheet];
    } catch (e) { var style = h('style'); style.textContent = CSS; root.appendChild(style); }

    var hf = h('div', { class: 'hf', 'data-pos': CFG.position, lang: 'en' });
    hf.style.setProperty('--z', CFG.z); hf.style.setProperty('--ox', CFG.side + 'px'); hf.style.setProperty('--oy', CFG.bottom + 'px');
    if (CFG.accent) { hf.style.setProperty('--gold', CFG.accent); hf.style.setProperty('--gold2', CFG.accent); }
    if (CFG.brand) { hf.style.setProperty('--navy', CFG.brand); hf.style.setProperty('--navy2', CFG.brand); }

    els.launcher = h('button', { class: 'launcher', type: 'button', 'aria-label': 'Open chat with John', 'aria-expanded': 'false', 'aria-controls': 'hf-panel' }, [
      h('span', { class: 'ic ic-chat' }, [svg(ICON.chat, 28)]), h('span', { class: 'ic ic-x' }, [svg(ICON.close, 26)])
    ]);
    els.badge = h('span', { class: 'badge', hidden: true, 'aria-hidden': 'true' });
    els.launcher.appendChild(els.badge);

    els.teaser = h('div', { class: 'teaser', role: 'status', hidden: true }, [
      h('button', { class: 't-open', type: 'button', text: CFG.teaserText }),
      h('button', { class: 't-x', type: 'button', 'aria-label': 'Dismiss message' }, [svg(ICON.close, 16)])
    ]);

    els.newBtn = h('button', { class: 'ibtn new', type: 'button', 'aria-label': 'Start a new chat', title: 'Start a new chat' }, [svg(ICON.refresh, 18), h('span', { class: 'lbl', text: 'New chat' })]);
    els.closeBtn = h('button', { class: 'ibtn close', type: 'button', 'aria-label': 'Close chat', title: 'Close chat' }, [svg(ICON.chevron, 24)]);
    var head = h('header', { class: 'head' }, [
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: 'J' }),
      h('div', { class: 'titles' }, [h('h2', { class: 'title', text: CFG.title }), h('p', { class: 'sub', text: CFG.subtitle })]),
      els.newBtn, els.closeBtn
    ]);

    els.banner = h('div', { class: 'banner', role: 'status', hidden: true, text: "You're offline. Chat will work again when you reconnect." });
    els.confirm = h('div', { class: 'confirm', role: 'group', 'aria-label': 'Start a new chat', hidden: true }, [
      h('p', { text: 'Start a new chat? This clears the conversation on your screen.' }),
      h('div', { class: 'btns' }, [h('button', { class: 'btn primary c-yes', type: 'button', text: 'Start new chat' }), h('button', { class: 'btn c-no', type: 'button', text: 'Keep chatting' })])
    ]);
    els.log = h('div', { class: 'log', role: 'log', tabindex: '0', 'aria-label': 'Conversation with John', 'aria-live': 'off' });
    els.jump = h('button', { class: 'jump', type: 'button', hidden: true }, [svg(ICON.down, 16), h('span', { text: 'New messages' })]);
    els.chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick replies' });
    CFG.chips.forEach(function (c) { els.chips.appendChild(h('button', { class: 'chip', type: 'button', 'data-text': c.text, text: c.label })); });

    els.input = h('textarea', { rows: '1', maxlength: String(CFG.maxChars), placeholder: CFG.placeholder, 'aria-label': 'Type your message', enterkeyhint: 'send', autocomplete: 'off', autocapitalize: 'sentences' });
    els.count = h('span', { class: 'count', hidden: true, 'aria-hidden': 'true' });
    els.send = h('button', { class: 'send', type: 'submit', 'aria-label': 'Send message', disabled: true }, [svg(ICON.send, 20)]);
    els.form = h('form', { class: 'composer', novalidate: true }, [h('div', { class: 'field' }, [els.input, els.count]), els.send]);

    var notice = h('p', { class: 'notice' }, [document.createTextNode("You're chatting with an AI assistant. Chats may be recorded.")]);
    if (CFG.privacyUrl) { notice.appendChild(document.createTextNode(' ')); notice.appendChild(h('a', { href: CFG.privacyUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Privacy' })); }
    els.live = h('div', { class: 'sr', 'aria-live': 'polite', 'aria-atomic': 'true' });

    els.panel = h('section', { class: 'panel', id: 'hf-panel', role: 'dialog', 'aria-label': 'Chat with John at Hudson and Fifth Realty', 'aria-modal': 'false', inert: true, 'aria-hidden': 'true' },
      [head, els.banner, els.confirm, els.log, els.jump, els.chips, els.form, notice, els.live]);

    hf.appendChild(els.panel); hf.appendChild(els.teaser); hf.appendChild(els.launcher);
    root.appendChild(hf);
    els.host = host; els.root = root; els.hf = hf;
    document.body.appendChild(host);
    applyScheme();
  }

  function applyScheme() {
    var scheme = CFG.theme;
    if (scheme === 'auto') scheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    els.hf.setAttribute('data-scheme', scheme);
  }

  // ------------------------------------------------------------------ messages
  function nearBottom() { var l = els.log; return l.scrollHeight - l.scrollTop - l.clientHeight < 80; }
  function toBottom(smooth) {
    var l = els.log;
    if (smooth) l.scrollTop = l.scrollHeight;
    else { var prev = l.style.scrollBehavior; l.style.scrollBehavior = 'auto'; l.scrollTop = l.scrollHeight; l.style.scrollBehavior = prev; }
    els.jump.hidden = true;
  }
  function lastRole() { var rows = els.log.querySelectorAll('.row'); return rows.length ? rows[rows.length - 1].getAttribute('data-r') : ''; }
  function scrolled(stick) { if (stick) toBottom(false); else els.jump.hidden = false; }

  function addRow(role, text, cls) {
    var stick = nearBottom() || role === 'u';
    var row = h('div', { class: 'row ' + role, 'data-r': role });
    var bubble = h('div', { class: 'bubble' + (cls ? ' ' + cls : '') });
    if (role === 'a') row.appendChild(h('div', { class: 'mini' + (lastRole() === 'a' ? ' ghost' : ''), 'aria-hidden': 'true', text: 'J' }));
    row.appendChild(bubble);
    if (text) renderInto(bubble, text);
    els.log.appendChild(row);
    scrolled(stick);
    return { row: row, bubble: bubble };
  }
  function addNote(text) {
    var stick = nearBottom();
    var row = h('div', { class: 'row n', 'data-r': 'n' }, [h('div', { class: 'bubble note', text: text })]);
    els.log.appendChild(row); scrolled(stick);
  }

  function showGreeting() { els.log.textContent = ''; addRow('a', CFG.greeting); els.chips.hidden = state.chipsDone; }
  function renderHistory() {
    if (!state.msgs.length) { showGreeting(); return; }
    els.log.textContent = ''; addRow('a', CFG.greeting);
    state.msgs.forEach(function (m) { addRow(m.r, m.t); });
    els.chips.hidden = true; toBottom(false);
  }

  function showTyping() {
    if (typingRow) return;
    typingRow = addRow('a', '', 'typing');
    typingRow.bubble.appendChild(h('span', { class: 'dots', role: 'img', 'aria-label': 'John is typing' }, [h('i'), h('i'), h('i')]));
    els.live.textContent = 'John is typing';
  }
  function hideTyping() { if (typingRow) { typingRow.row.remove(); typingRow = null; } }

  // ------------------------------------------------------------------ errors
  function errorText(code) {
    var contact = (CFG.phone ? ' You can call us at ' + CFG.phone + '.' : '') + (CFG.email ? ' Or email ' + CFG.email + '.' : '');
    switch (code) {
      case 'rate_limited': return 'You are sending messages quickly. Please wait a few seconds and try again.';
      case 'busy': return 'We are very busy right now. Please try again in a moment.';
      case 'chat_unavailable': return 'Chat is not available right now.' + contact;
      case 'session_limit': return 'This chat has reached its length limit. Please start a new chat to continue.';
      case 'message_too_long': return 'That message is too long. Please shorten it and try again.';
      case 'origin_not_allowed': return 'Chat is not enabled on this website yet.';
      case 'offline': return 'You appear to be offline. Check your connection and try again.';
      case 'upstream_timeout': case 'timeout': return 'That took too long. Please try again.';
      case 'network': return "I couldn't reach the chat service. Check your connection and try again." + contact;
      default: return 'Something went wrong on our side. Please try again.' + contact;
    }
  }
  function showError(code, noRetry) {
    hideTyping();
    var r = addRow('a', '', 'err');
    r.row.setAttribute('role', 'alert');
    var msg = h('div'); renderInto(msg, errorText(code)); r.bubble.appendChild(msg);
    if (code === 'session_limit') {
      var nb = h('button', { class: 'btn primary', type: 'button', text: 'Start new chat' });
      nb.addEventListener('click', function () { newChat(true); }); r.bubble.appendChild(nb);
    } else if (!noRetry && state.lastText && !/^(message_too_long|origin_not_allowed|chat_unavailable)$/.test(code)) {
      var rb = h('button', { class: 'btn', type: 'button', text: 'Try again' });
      rb.addEventListener('click', function () { r.row.remove(); run(state.lastText, true); });
      r.bubble.appendChild(rb);
    }
    emit('error', { code: code });
  }

  // ------------------------------------------------------------------ talking to the proxy
  function apiError(code, status) { var e = new Error(code); e.code = code; e.status = status; return e; }

  async function readSse(res, onEvent) {
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true }).replace(/\r\n/g, '\n');
      var i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        var blk = buf.slice(0, i); buf = buf.slice(i + 2);
        var ev = 'message', data = [];
        blk.split('\n').forEach(function (l) { if (l.indexOf('event:') === 0) ev = l.slice(6).trim(); else if (l.indexOf('data:') === 0) data.push(l.slice(5).replace(/^ /, '')); });
        if (!data.length) continue;
        var obj = null; try { obj = JSON.parse(data.join('\n')); } catch (e) { continue; }
        onEvent(ev, obj);
      }
    }
  }

  async function run(text, isRetry) {
    if (state.busy) return;
    state.lastText = text; state.busy = true; setBusy(true);
    if (!isRetry) emit('message', { from: 'visitor' });
    showTyping();
    var ac = new AbortController(); state.abort = ac;
    var killer = setTimeout(function () { ac.abort(); }, 90000);
    var reply = '', bubble = null, streamErr = null, paint = 0, renew = false;
    function flush() {
      paint = 0;
      if (!bubble) return;
      var stick = nearBottom(); renderInto(bubble.bubble, reply); bubble.bubble.classList.add('caret'); scrolled(stick);
    }
    try {
      if (!CFG.api) throw apiError('chat_unavailable');
      if (navigator.onLine === false) throw apiError('offline');
      var res;
      try {
        res = await fetch(CFG.api + '/v1/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, sid: state.sid || undefined, stream: true }), signal: ac.signal, cache: 'no-store', credentials: 'omit', mode: 'cors' });
      } catch (e) { throw apiError(ac.signal.aborted ? 'timeout' : 'network'); }
      if (!res.ok) {
        var j = null; try { j = await res.json(); } catch (e) { /* not JSON */ }
        throw apiError((j && j.error && j.error.code) || 'http_' + res.status, res.status);
      }
      var onEvent = function (ev, d) {
        if (ev === 'session') { if (d.sid) { state.sid = d.sid; persist(); } }
        else if (ev === 'delta') {
          if (!bubble) { hideTyping(); bubble = addRow('a', ''); bubble.bubble.classList.add('caret'); }
          reply += d.text; if (!paint) paint = requestAnimationFrame(flush);
        } else if (ev === 'error') streamErr = d.code || 'upstream_error';
      };
      if ((res.headers.get('Content-Type') || '').indexOf('text/event-stream') !== -1 && res.body) {
        try { await readSse(res, onEvent); } catch (e) { if (!streamErr) streamErr = ac.signal.aborted ? 'timeout' : 'network'; }
      } else {
        var data = await res.json();
        if (data && data.sid) { state.sid = data.sid; persist(); }
        if (data && data.reply) onEvent('delta', { text: data.reply });
      }
      if (paint) { cancelAnimationFrame(paint); paint = 0; }
      if (bubble) { bubble.bubble.classList.remove('caret'); renderInto(bubble.bubble, reply); }
      if (streamErr) throw apiError(streamErr);
      hideTyping();
      if (!bubble) { reply = "Sorry, I didn't catch that. Could you say it another way?"; addRow('a', reply); }
      state.msgs.push({ r: 'u', t: text }, { r: 'a', t: reply }); persist();
      els.live.textContent = reply;
      if (!state.open) { state.unread++; updateBadge(); }
      state.renewed = false;
      emit('message', { from: 'assistant' });
    } catch (e) {
      if (paint) { cancelAnimationFrame(paint); paint = 0; }
      if (bubble) bubble.bubble.classList.remove('caret');
      var code = e && e.code ? e.code : 'upstream_error';
      if (code === 'session_invalid' && !state.renewed) renew = true;      // the chat expired on Vapi's side: start fresh once
      else showError(code === 'session_invalid' ? 'upstream_error' : code);
    } finally {
      clearTimeout(killer); state.abort = null; state.busy = false; setBusy(false);
    }
    if (renew) {
      state.renewed = true; state.sid = ''; hideTyping();
      addNote('Your earlier chat expired, so I started a fresh one.');
      return run(text, true);
    }
    refocus();
  }

  function refocus() { if (state.open && !mq.matches) els.input.focus({ preventScroll: true }); }
  function setBusy(b) { els.panel.setAttribute('aria-busy', b ? 'true' : 'false'); updateSend(); }
  function updateSend() { els.send.disabled = state.busy || !els.input.value.trim(); }

  function send(text) {
    text = String(text == null ? els.input.value : text).trim();
    if (!text || state.busy) return false;
    if (text.length > CFG.maxChars) { state.lastText = ''; showError('message_too_long', true); return false; }
    els.confirm.hidden = true;
    state.chipsDone = true; els.chips.hidden = true;
    addRow('u', text);
    els.input.value = ''; autosize(); updateSend(); persist();
    run(text, false);
    return true;
  }

  function autosize() {
    var t = els.input; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px';
    var left = CFG.maxChars - t.value.length;
    if (left <= 100) { els.count.hidden = false; els.count.textContent = left + ' left'; } else els.count.hidden = true;
  }

  // ------------------------------------------------------------------ open / close / new chat
  function lockScroll(on) {
    var de = document.documentElement;
    if (on && mq.matches && !scrollLock) { scrollLock = { o: de.style.overflow }; de.style.overflow = 'hidden'; }
    else if (!on && scrollLock) { de.style.overflow = scrollLock.o; scrollLock = null; }
  }
  function fitViewport() {
    var vv = window.visualViewport;
    if (!vv || !mq.matches || !state.open) { els.hf.style.removeProperty('--vvh'); els.hf.style.removeProperty('--vvtop'); return; }
    els.hf.style.setProperty('--vvh', vv.height + 'px'); els.hf.style.setProperty('--vvtop', vv.offsetTop + 'px');
  }
  function updateBadge() {
    els.badge.hidden = !state.unread; els.badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
    els.launcher.setAttribute('aria-label', state.open ? 'Close chat' : state.unread ? 'Open chat with John, ' + state.unread + ' new message' + (state.unread > 1 ? 's' : '') : 'Open chat with John');
  }
  function open(opts) {
    if (state.open) return;
    state.open = true; state.unread = 0; updateBadge();
    els.hf.classList.add('open'); els.hf.classList.remove('pulse');
    els.panel.removeAttribute('inert'); els.panel.removeAttribute('aria-hidden');
    els.launcher.setAttribute('aria-expanded', 'true');
    els.teaser.hidden = true; lockScroll(true); fitViewport(); toBottom(false); persist();
    if (!(opts && opts.silent)) requestAnimationFrame(function () { els.input.focus({ preventScroll: true }); });
    emit('open');
  }
  function close(opts) {
    if (!state.open) return;
    state.open = false;
    els.hf.classList.remove('open'); els.panel.setAttribute('inert', ''); els.panel.setAttribute('aria-hidden', 'true');
    els.launcher.setAttribute('aria-expanded', 'false'); updateBadge(); lockScroll(false); fitViewport(); persist();
    if (!(opts && opts.silent)) els.launcher.focus({ preventScroll: true });
    emit('close');
  }
  function newChat(skipConfirm) {
    if (state.msgs.length && !skipConfirm) { els.confirm.hidden = false; els.confirm.querySelector('.c-yes').focus(); return; }
    if (state.abort) state.abort.abort();
    els.confirm.hidden = true; typingRow = null;
    state.sid = ''; state.msgs = []; state.chipsDone = false; state.lastText = ''; state.renewed = false;
    setBusy(false); showGreeting(); persist();
    els.live.textContent = 'Started a new chat.';
    emit('new');
    if (state.open) els.input.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ wiring
  function trapTab(e) {
    if (!mq.matches || !state.open || e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(els.panel.querySelectorAll('button:not([disabled]),textarea,a[href],[tabindex="0"]'), function (n) { return !n.closest('[hidden]') && n.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], active = els.root.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  function wire() {
    els.launcher.addEventListener('click', function () { if (state.open) close(); else open(); });
    els.closeBtn.addEventListener('click', function () { close(); });
    els.newBtn.addEventListener('click', function () { newChat(false); });
    els.confirm.querySelector('.c-yes').addEventListener('click', function () { newChat(true); });
    els.confirm.querySelector('.c-no').addEventListener('click', function () { els.confirm.hidden = true; els.input.focus({ preventScroll: true }); });
    els.teaser.querySelector('.t-open').addEventListener('click', function () { open(); });
    els.teaser.querySelector('.t-x').addEventListener('click', function () { els.teaser.hidden = true; els.launcher.focus(); });
    els.jump.addEventListener('click', function () { toBottom(true); });
    els.log.addEventListener('scroll', function () { if (nearBottom()) els.jump.hidden = true; });
    els.chips.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('.chip') : null; if (b) send(b.getAttribute('data-text')); });
    els.form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    els.input.addEventListener('input', function () { autosize(); updateSend(); });
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    els.panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } trapTab(e); });
    window.addEventListener('online', function () { els.banner.hidden = true; });
    window.addEventListener('offline', function () { els.banner.hidden = false; });
    if (navigator.onLine === false) els.banner.hidden = false;
    var onMq = function () { fitViewport(); lockScroll(state.open); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
    if (window.matchMedia && CFG.theme === 'auto') { var dm = window.matchMedia('(prefers-color-scheme: dark)'); if (dm.addEventListener) dm.addEventListener('change', applyScheme); }
  }

  // ------------------------------------------------------------------ start
  function init() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', init, { once: true }); return; }
    if (document.getElementById('hudson-chat-host')) return;
    build(); wire();
    var had = restore();
    renderHistory(); autosize(); updateSend(); updateBadge();
    if (had && state.open) { state.open = false; open({ silent: true }); }
    else if (CFG.autoOpen && !mq.matches) open({ silent: true });
    else {
      els.hf.classList.add('pulse');
      var s = store(), shown = false;
      try { shown = !!(s && s.getItem(KEY + ':teaser')); } catch (e) { /* ignore */ }
      if (CFG.teaser && !shown && !state.msgs.length) setTimeout(function () {
        if (state.open || state.msgs.length) return;
        els.teaser.hidden = false;
        try { if (s) s.setItem(KEY + ':teaser', '1'); } catch (e) { /* ignore */ }
        setTimeout(function () { els.teaser.hidden = true; }, 14000);
      }, 6000);
    }
  }

  window.HudsonChat = {
    version: '1.0.0',
    open: function () { open(); }, close: function () { close(); },
    toggle: function () { if (state.open) close(); else open(); },
    newChat: function () { newChat(true); },
    send: function (t) { open(); return send(t); },
    isOpen: function () { return state.open; }
  };

  try { init(); } catch (e) { if (window.console) console.warn('[hudson-chat] could not start:', e); }
})();
