/* Simulated chat backend for the demo page ONLY.
 * It answers the widget's requests locally (same streaming format as the real proxy) so the design can be tried
 * before the live assistant is connected. It does not talk to Vapi and books nothing. */
(function () {
  'use strict';
  var realFetch = window.fetch.bind(window);

  function nextDays() {
    var out = [], d = new Date(), want = [4, 5, 6];            // Thursday, Friday, Saturday
    var times = { 4: '6:00 PM', 5: '2:00 PM', 6: '11:00 AM' };
    for (var i = 1; i < 14 && out.length < 3; i++) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
      if (want.indexOf(x.getDay()) !== -1) out.push(x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' at ' + times[x.getDay()]);
    }
    return out;
  }

  var FAQ = [
    [/sunday/i, 'On Sunday our offices are open from 11:00 AM to 5:00 PM, and viewings run from 11:00 AM to 4:00 PM.'],
    [/hours|open|close/i, 'Our offices are open seven days a week. Weekdays 9:00 AM to 7:00 PM, Saturday 10:00 AM to 6:00 PM and Sunday 11:00 AM to 5:00 PM.'],
    [/broker.?fee|fee/i, 'For rentals the broker fee is paid by whoever hired the broker. Some listings, like R-1004, have no broker fee for the tenant.'],
    [/co-?op|condo/i, 'A condo is owned outright. In a co-op you own shares in a corporation, and the board approves every buyer.'],
    [/r-?1002/i, 'R-1002 is Skyline Tower in Long Island City: 2 bed, 2 bath, 980 sq ft, $4,850 a month, with a rooftop pool and in-unit washer and dryer.'],
    [/r-?1001/i, 'R-1001 is The Lexington on the Upper East Side: 1 bed, 1 bath, 650 sq ft, $3,650 a month. Doorman, gym and pets allowed.'],
    [/r-?1003/i, 'R-1003 is Bedford Lofts in Williamsburg: studio, 520 sq ft, $3,200 a month, exposed brick and one block to the L train.'],
    [/r-?1004/i, 'R-1004 is a renovated Hell\'s Kitchen walk-up: 2 bed, 1 bath, 800 sq ft, $4,300 a month, no broker fee for the tenant and available now.']
  ];

  function reply(text, st) {
    var t = text.toLowerCase();
    for (var i = 0; i < FAQ.length; i++) if (FAQ[i][0].test(text)) return FAQ[i][1];
    if (st.step === 'slots') {
      var slots = nextDays(), pick = slots.filter(function (s) { return t.indexOf(s.split(' ')[0].toLowerCase()) !== -1; })[0] || slots[0];
      st.slot = pick; st.step = 'name';
      return 'Perfect, ' + pick + '. May I have your full name?';
    }
    if (st.step === 'name') { st.name = text.replace(/[^\w .'-]/g, '').trim() || 'there'; st.step = 'phone'; return 'Thanks, ' + st.name.split(' ')[0] + '. What is the best phone number to reach you?'; }
    if (st.step === 'phone') { st.phone = text; st.step = 'email'; return 'And your email address, so I can send the confirmation?'; }
    if (st.step === 'email') { st.email = text; st.step = 'confirm'; return 'Let me confirm: ' + st.name + ', ' + st.email + ', ' + st.slot + '. Is that right?'; }
    if (st.step === 'confirm') {
      st.step = '';
      return /^(y|yes|yeah|yep|correct|right)/i.test(t) ? 'You are all set. This is a simulated booking, so nothing was scheduled. With the live assistant, a confirmation email arrives within a minute. Anything else?' : 'No problem. Tell me what to change and I will update it.';
    }
    if (/book|viewing|tour|see (it|the)/.test(t) || st.step === 'day') {
      st.step = 'slots';
      return 'I can set that up. Here are the next openings:\n' + nextDays().map(function (s) { return '- ' + s; }).join('\n') + '\nWhich one works for you?';
    }
    if (/\brent|apartment|lease/.test(t)) { st.step = 'budget'; return 'Happy to help with a rental. What is your monthly budget?'; }
    if (st.step === 'budget') { st.step = 'beds'; return 'Got it. How many bedrooms do you need, and which neighborhoods do you like?'; }
    if (st.step === 'beds') { st.step = 'move'; return 'Thanks. When would you like to move in, and do you have any pets?'; }
    if (st.step === 'move') { st.step = 'day'; return 'Great. I can set up a viewing for you. Which day works best?'; }
    if (/\bbuy|purchase/.test(t)) return 'Great. Are you planning to pay cash, or use a mortgage?';
    if (/\bsell|valuation/.test(t)) return 'Happy to help you sell. What is the address or area of the property? We also offer a free valuation.';
    if (/person|human|agent|call me|callback/.test(t)) return 'Of course. What is your name and the best number to call? A team member will call you back within about 15 minutes during office hours.';
    return 'I can help with rentals, sales and viewings. What are you looking for?';
  }

  function install(base) {
    var sessions = {};
    var enc = new TextEncoder();
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input.url;
      if (url.indexOf(base + '/v1/chat') !== 0) return realFetch(input, init);
      var body = {}; try { body = JSON.parse(init.body); } catch (e) { /* ignore */ }
      var text = String(body.message || '');
      if (/test error|#error/i.test(text)) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'chat_unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      }
      var sid = body.sid && sessions[body.sid] ? body.sid : 'sim.' + Math.random().toString(36).slice(2, 10);
      var st = sessions[sid] || (sessions[sid] = { step: '', turn: 0 });
      st.turn++;
      var answer = reply(text, st);
      var words = answer.match(/\S+\s*|\n/g) || [answer];
      var stream = new ReadableStream({
        start: function (c) {
          var send = function (ev, d) { c.enqueue(enc.encode('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n')); };
          var i = 0;
          setTimeout(function () {
            send('session', { sid: sid, turn: st.turn });
            (function tick() {
              if (i >= words.length) { send('done', { turn: st.turn, chars: answer.length }); c.close(); return; }
              send('delta', { text: words[i++] });
              setTimeout(tick, 28 + Math.random() * 40);
            })();
          }, 650 + Math.random() * 450);
        }
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }));
    };
  }

  window.HudsonChatSim = { install: install };
})();
