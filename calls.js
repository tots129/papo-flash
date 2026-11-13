// Chamadas de voz e vídeo do Papo Flash (duas pessoas ou grupo).
// Cada aparelho conversa direto com os outros (WebRTC). O Firebase só "toca" a chamada
// e leva os recados de conexão entre os aparelhos.

const RING_MS = 45 * 1000; // tempo tocando antes de virar "não atendida"
const BEAT_MS = 15 * 1000; // "ainda estou aqui"
const GHOST_MS = 50 * 1000; // sem sinal por esse tempo = saiu sem desligar

export function initCalls(ctx) {
  const { api, S, profile, avatarHtml, toast, esc, errText, convoName, isDm, otherOf, iBlocked } = ctx;
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  let turnCache = null; // { at, list }
  /** Servidores de conexão: STUN do Google + ponte (TURN) quando configurada. */
  async function getIce() {
    let turn = [];
    if (api.turnCredentialsUrl) {
      if (turnCache && Date.now() - turnCache.at < 30 * 60 * 1000) turn = turnCache.list;
      else {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 6000);
          const r = await fetch(api.turnCredentialsUrl, { signal: ctl.signal });
          clearTimeout(timer);
          const list = await r.json();
          if (Array.isArray(list)) {
            turn = list;
            turnCache = { at: Date.now(), list };
          }
        } catch (_) {
          /* sem ponte: tenta direto */
        }
      }
    }
    return [...STUN, ...turn, ...api.extraIceServers];
  }

  let A = null; // chamada em andamento
  let ringing = null; // { cid, callId } tocando agora
  const dismissed = new Set(); // chamadas que eu recusei/fechei
  let toneTimer = null;
  let audioCtx = null;

  // ------------------------------------------------------------- sons
  function beep(freq, dur, vol = 0.12) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (_) {
      /* sem som */
    }
  }
  function startTone(kind) {
    stopTone();
    const play = () => {
      if (kind === 'in') {
        beep(880, 0.25);
        setTimeout(() => beep(660, 0.3), 280);
      } else beep(440, 0.6, 0.06);
    };
    play();
    toneTimer = setInterval(play, kind === 'in' ? 2000 : 3000);
  }
  function stopTone() {
    clearInterval(toneTimer);
    toneTimer = null;
  }

  // ------------------------------------------------------------- tela
  const screen = document.createElement('div');
  screen.className = 'call-screen';
  screen.hidden = true;
  document.body.appendChild(screen);
  const ringBox = document.createElement('div');
  ringBox.className = 'call-ring';
  ringBox.hidden = true;
  document.body.appendChild(ringBox);

  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const nameOf = (uid) => (uid === S.me.uid ? 'Você' : profile(uid).name);

  function drawScreen() {
    if (!A) {
      screen.hidden = true;
      screen.innerHTML = '';
      return;
    }
    screen.hidden = false;
    screen.classList.toggle('min', A.min);
    screen.classList.toggle('is-video', A.kind === 'video');
    const c = S.convos.find((x) => x.id === A.cid);
    const title = c ? convoName(c) : 'Chamada';
    screen.innerHTML = `
      <div class="call-top"><div><b>${esc(title)}</b><small data-call-status></small></div>
        <button class="icon-btn" data-call-min title="${A.min ? 'Abrir chamada' : 'Voltar para a conversa'}" aria-label="${A.min ? 'Abrir chamada' : 'Minimizar chamada'}">${A.min ? '⤢' : '⤡'}</button></div>
      <div class="call-grid" data-call-grid></div>
      <div class="call-local" data-call-local hidden><video autoplay playsinline muted></video></div>
      <div class="call-controls">
        <button class="call-btn ${A.muted ? 'off' : ''}" data-call-mic aria-label="${A.muted ? 'Ligar microfone' : 'Desligar microfone'}" title="Microfone">${A.muted ? '🔇' : '🎤'}</button>
        ${A.kind === 'video' ? `<button class="call-btn ${A.camOff ? 'off' : ''}" data-call-cam aria-label="${A.camOff ? 'Ligar câmera' : 'Desligar câmera'}" title="Câmera">${A.camOff ? '🚫' : '🎥'}</button>` : ''}
        ${A.kind === 'video' && A.canFlip ? '<button class="call-btn" data-call-flip aria-label="Trocar câmera" title="Trocar câmera">🔄</button>' : ''}
        <button class="call-btn hang" data-call-hang aria-label="Desligar" title="Desligar">📞</button>
      </div>`;
    const lv = screen.querySelector('[data-call-local] video');
    if (A.kind === 'video' && A.local) {
      lv.srcObject = A.local;
      screen.querySelector('[data-call-local]').hidden = false;
    }
    drawTiles();
    drawStatus();
  }

  function drawTiles() {
    if (!A) return;
    const grid = screen.querySelector('[data-call-grid]');
    if (!grid) return;
    const uids = [...A.peers.keys()];
    grid.dataset.n = String(Math.max(1, uids.length));
    // remove quem saiu
    grid.querySelectorAll('[data-tile]').forEach((t) => !A.peers.has(t.dataset.tile) && t.remove());
    if (!uids.length) {
      if (!grid.querySelector('.call-wait')) {
        const c = S.convos.find((x) => x.id === A.cid);
        const other = c && isDm(c) ? otherOf(c) : null;
        grid.innerHTML = `<div class="call-wait">${other ? avatarHtml(other, 96) : '<div class="call-wait-ico">📞</div>'}<p>${other ? `Chamando ${esc(profile(other).name)}…` : 'Esperando alguém entrar…'}</p></div>`;
      }
      return;
    }
    grid.querySelector('.call-wait')?.remove();
    for (const uid of uids) {
      const p = A.peers.get(uid);
      let t = grid.querySelector(`[data-tile="${CSS.escape(uid)}"]`);
      if (!t) {
        t = document.createElement('div');
        t.className = 'call-tile';
        t.dataset.tile = uid;
        t.innerHTML = `<div class="tile-av">${avatarHtml(uid, 88)}</div><video autoplay playsinline></video><span class="tile-name">${esc(nameOf(uid))}</span><span class="tile-state"></span>`;
        grid.appendChild(t);
      }
      const v = t.querySelector('video');
      if (p.stream && v.srcObject !== p.stream) v.srcObject = p.stream;
      const hasVideo = !!(p.stream && p.stream.getVideoTracks().some((tr) => tr.readyState === 'live' && !tr.muted));
      t.classList.toggle('has-video', hasVideo);
      const st = p.pc.connectionState;
      t.querySelector('.tile-state').textContent = st === 'connected' ? '' : st === 'failed' ? '⚠️ não conectou' : st === 'disconnected' ? 'conexão fraca…' : 'conectando…';
    }
  }

  function drawStatus() {
    const el = screen.querySelector('[data-call-status]');
    if (!el || !A) return;
    const anyone = [...A.peers.values()].some((p) => p.pc.connectionState === 'connected');
    el.textContent = anyone ? `${A.kind === 'video' ? 'Vídeo' : 'Voz'} · ${fmt((Date.now() - (A.connectedAt || Date.now())) / 1000)}` : A.peers.size ? 'Conectando…' : 'Chamando…';
  }

  // ------------------------------------------------------------- conexão com cada pessoa
  function makePeer(uid) {
    const pc = new RTCPeerConnection({ iceServers: A.ice || STUN });
    const p = { pc, stream: null, pending: [] };
    A.peers.set(uid, p);
    A.local.getTracks().forEach((tr) => pc.addTrack(tr, A.local));
    const cid = A.cid;
    const callId = A.callId;
    pc.onicecandidate = (e) => {
      if (e.candidate) api.sendSignal(cid, callId, S.me.uid, uid, 'ice', JSON.stringify(e.candidate)).catch(() => {});
    };
    pc.ontrack = (e) => {
      p.stream = e.streams[0] || new MediaStream([e.track]);
      e.track.onunmute = drawTiles;
      e.track.onmute = drawTiles;
      e.track.onended = drawTiles;
      drawTiles();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && p.initiator && !p.restarted && A) {
        // tenta mais uma vez, procurando outro caminho
        p.restarted = true;
        pc.createOffer({ iceRestart: true })
          .then((o) => pc.setLocalDescription(o))
          .then(() => api.sendSignal(cid, callId, S.me.uid, uid, 'offer', JSON.stringify(pc.localDescription)))
          .catch(() => {});
      }
      if (pc.connectionState === 'connected' && A && !A.connectedAt) {
        A.connectedAt = Date.now();
        stopTone();
      }
      drawTiles();
      drawStatus();
    };
    // ICE que chegou antes da conexão existir
    const early = A.earlyIce.get(uid);
    if (early) {
      p.pending.push(...early);
      A.earlyIce.delete(uid);
    }
    drawTiles();
    return p;
  }

  async function callPerson(uid) {
    if (!A || A.peers.has(uid)) return;
    const p = makePeer(uid);
    p.initiator = true;
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    await api.sendSignal(A.cid, A.callId, S.me.uid, uid, 'offer', JSON.stringify(p.pc.localDescription));
  }

  async function flushIce(p) {
    while (p.pending.length) {
      try {
        await p.pc.addIceCandidate(p.pending.shift());
      } catch (_) {
        /* ok */
      }
    }
  }

  async function onSignals(list) {
    for (const sg of list) {
      if (!A) return;
      api.deleteSignal(A.cid, A.callId, sg.id);
      try {
        const data = JSON.parse(sg.data);
        if (sg.type === 'offer') {
          let p = A.peers.get(sg.from);
          if (p) {
            // reconexão: começa de novo com essa pessoa
            p.pc.close();
            A.peers.delete(sg.from);
          }
          p = makePeer(sg.from);
          await p.pc.setRemoteDescription(data);
          await flushIce(p);
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          await api.sendSignal(A.cid, A.callId, S.me.uid, sg.from, 'answer', JSON.stringify(p.pc.localDescription));
        } else if (sg.type === 'answer') {
          const p = A.peers.get(sg.from);
          if (p && p.pc.signalingState === 'have-local-offer') {
            await p.pc.setRemoteDescription(data);
            await flushIce(p);
          }
        } else if (sg.type === 'ice') {
          const p = A.peers.get(sg.from);
          if (p && p.pc.remoteDescription) await p.pc.addIceCandidate(data).catch(() => {});
          else if (p) p.pending.push(data);
          else A.earlyIce.set(sg.from, [...(A.earlyIce.get(sg.from) || []), data]);
        }
      } catch (_) {
        /* recado estragado: ignora */
      }
    }
  }

  function dropPeer(uid) {
    const p = A && A.peers.get(uid);
    if (!p) return;
    try {
      p.pc.close();
    } catch (_) {
      /* ok */
    }
    A.peers.delete(uid);
    drawTiles();
    drawStatus();
  }

  // ------------------------------------------------------------- entrar / sair
  async function getMedia(kind) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: kind === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
    } catch (err) {
      if (kind === 'video') {
        toast('Não deu para usar a câmera. Vou entrar só com voz.', 'error');
        return getMedia('audio');
      }
      throw new Error('Não deu para usar o microfone. Libere o microfone para este site nas configurações do navegador.');
    }
  }

  async function enter(c, kind, existingCallId) {
    if (A) {
      if (A.cid === c.id) {
        A.min = false;
        drawScreen();
        return;
      }
      return toast('Você já está numa chamada. Desligue antes de começar outra.', 'error');
    }
    if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast('Este navegador não faz chamadas. Use o Chrome, Edge ou Safari atualizados.', 'error');
    hideRing();
    let local;
    try {
      local = await getMedia(kind);
    } catch (err) {
      return toast(errText(err), 'error');
    }
    const ice = await getIce();
    const realKind = local.getVideoTracks().length ? 'video' : 'audio';
    A = { cid: c.id, callId: null, kind: realKind, local, ice, peers: new Map(), earlyIce: new Map(), muted: false, camOff: false, facing: 'user', min: false, joinedAt: Date.now(), connectedAt: 0, canFlip: false };
    drawScreen();
    try {
      const r = existingCallId ? await api.callJoin(c.id, existingCallId, S.me.uid) : await api.callStart(c.id, S.me.uid, kind);
      if (!A) return; // desligou enquanto conectava
      A.callId = r.id;
      if (r.kind && r.kind !== A.kind && r.kind === 'audio') {
        // entrou numa chamada de voz com câmera: desliga o vídeo
        A.local.getVideoTracks().forEach((t) => (t.stop(), A.local.removeTrack(t)));
        A.kind = 'audio';
        drawScreen();
      }
      dismissed.add(r.id);
      A.unsubSignals = api.watchSignals(c.id, r.id, S.me.uid, onSignals);
      A.unsubCall = api.watchCall(c.id, r.id, (beats) => (A ? (A.beats = beats) : null));
      api.callBeat(c.id, r.id, S.me.uid);
      A.beatTimer = setInterval(tick, BEAT_MS);
      A.statusTimer = setInterval(drawStatus, 1000);
      if (!r.people.length) startTone('out');
      for (const uid of r.people) callPerson(uid).catch(() => {});
      navigator.mediaDevices
        .enumerateDevices()
        .then((ds) => {
          if (A) {
            A.canFlip = ds.filter((d) => d.kind === 'videoinput').length > 1;
            if (A.canFlip && A.kind === 'video') drawScreen();
          }
        })
        .catch(() => {});
      window.__papoCall = A; // para testes
    } catch (err) {
      cleanup();
      toast(err && err.code === 'permission-denied' ? 'Não foi possível ligar. Talvez esta pessoa tenha bloqueado você.' : errText(err), 'error');
    }
  }

  function tick() {
    if (!A || !A.callId) return;
    api.callBeat(A.cid, A.callId, S.me.uid);
    const c = S.convos.find((x) => x.id === A.cid);
    if (!c || !c.call) return;
    const now = Date.now();
    // quem sumiu sem desligar
    for (const uid of c.call.people) {
      if (uid === S.me.uid) continue;
      const b = (A.beats || {})[uid] || 0;
      if (now - A.joinedAt > GHOST_MS && now - b > GHOST_MS) {
        dropPeer(uid);
        api.callDropGhost(A.cid, A.callId, uid);
      }
    }
  }

  function cleanup() {
    stopTone();
    if (!A) return;
    clearInterval(A.beatTimer);
    clearInterval(A.statusTimer);
    A.unsubSignals && A.unsubSignals();
    A.unsubCall && A.unsubCall();
    A.peers.forEach((p) => {
      try {
        p.pc.close();
      } catch (_) {
        /* ok */
      }
    });
    A.local && A.local.getTracks().forEach((t) => t.stop());
    A = null;
    window.__papoCall = null;
    drawScreen();
    ctx.rerender();
  }

  async function hangUp() {
    if (!A) return;
    const { cid, callId } = A;
    cleanup();
    if (callId) await api.callLeave(cid, callId, S.me.uid).catch(() => {});
  }

  // ------------------------------------------------------------- tocando
  function hideRing() {
    ringing = null;
    ringBox.hidden = true;
    ringBox.innerHTML = '';
    if (!A) stopTone();
  }

  function showRing(c) {
    if (ringing && ringing.callId === c.call.id) return;
    ringing = { cid: c.id, callId: c.call.id };
    const who = c.call.by;
    const group = !isDm(c);
    ringBox.hidden = false;
    ringBox.innerHTML = `<div class="ring-card" role="alertdialog" aria-label="Chamada chegando">
      ${group ? `<div class="ring-ico">${esc(c.emoji || '💬')}</div>` : avatarHtml(who, 72)}
      <div class="ring-text"><b>${esc(group ? convoName(c) : profile(who).name)}</b>
      <span>${group ? `${esc(profile(who).name)} começou uma chamada de ${c.call.kind === 'video' ? 'vídeo' : 'voz'}` : `está te ligando (${c.call.kind === 'video' ? 'vídeo' : 'voz'})…`}</span></div>
      <div class="ring-actions"><button class="call-btn hang" data-ring-no aria-label="Recusar" title="Recusar">📞</button>
      <button class="call-btn ok" data-ring-yes aria-label="Atender" title="Atender">${c.call.kind === 'video' ? '🎥' : '📞'}</button></div></div>`;
    startTone('in');
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(group ? `Chamada em ${convoName(c)}` : `${profile(who).name} está te ligando`, { body: 'Abra o Papo Flash para atender.', tag: 'call-' + c.call.id });
      } catch (_) {
        /* ok */
      }
    }
  }

  ringBox.addEventListener('click', (e) => {
    if (!ringing) return;
    const c = S.convos.find((x) => x.id === ringing.cid);
    if (e.target.closest('[data-ring-yes]')) {
      if (c && c.call) {
        location.hash = `#/c/${c.id}`;
        enter(c, c.call.kind, c.call.id);
      }
      hideRing();
    } else if (e.target.closest('[data-ring-no]')) {
      dismissed.add(ringing.callId);
      if (c && isDm(c)) api.callDecline(c.id, ringing.callId, S.me.uid);
      hideRing();
    }
  });

  screen.addEventListener('click', (e) => {
    if (!A) return;
    const t = e.target;
    if (t.closest('[data-call-hang]')) return hangUp();
    if (t.closest('[data-call-min]')) {
      A.min = !A.min;
      return drawScreen();
    }
    if (A.min && !t.closest('button')) {
      A.min = false;
      return drawScreen();
    }
    if (t.closest('[data-call-mic]')) {
      A.muted = !A.muted;
      A.local.getAudioTracks().forEach((tr) => (tr.enabled = !A.muted));
      return drawScreen();
    }
    if (t.closest('[data-call-cam]')) {
      A.camOff = !A.camOff;
      A.local.getVideoTracks().forEach((tr) => (tr.enabled = !A.camOff));
      return drawScreen();
    }
    if (t.closest('[data-call-flip]')) return flipCamera();
  });

  async function flipCamera() {
    if (!A) return;
    const facing = A.facing === 'user' ? 'environment' : 'user';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
      const nt = s.getVideoTracks()[0];
      const old = A.local.getVideoTracks()[0];
      A.peers.forEach((p) => {
        const sender = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        if (sender) sender.replaceTrack(nt);
      });
      if (old) {
        A.local.removeTrack(old);
        old.stop();
      }
      A.local.addTrack(nt);
      nt.enabled = !A.camOff;
      A.facing = facing;
      drawScreen();
    } catch (_) {
      toast('Não deu para trocar a câmera.', 'error');
    }
  }

  // ------------------------------------------------------------- a cada mudança nas conversas
  function onConvos() {
    if (!S.me) return;
    const now = Date.now();
    // chamada em andamento
    if (A && A.callId) {
      const c = S.convos.find((x) => x.id === A.cid);
      if (!c || !c.call || c.call.id !== A.callId) {
        cleanup();
        toast('A chamada terminou.');
      } else {
        for (const uid of [...A.peers.keys()]) if (!c.call.people.includes(uid)) dropPeer(uid);
        const others = c.call.people.filter((u) => u !== S.me.uid);
        // ninguém atendeu, ou recusaram
        const alone = !others.length && c.call.seen.length <= 1;
        const declinedAll = isDm(c) && alone && c.call.declined.includes(otherOf(c));
        if (alone && (declinedAll || now - c.call.startedAt > RING_MS)) {
          toast(declinedAll ? 'A pessoa recusou a chamada.' : 'Ninguém atendeu.');
          hangUp();
        } else if (!others.length && c.call.seen.length > 1 && A.peers.size === 0 && now - A.joinedAt > 3000) {
          // todo mundo saiu: encerra
          hangUp();
        }
      }
    }
    // tocar chamadas chegando
    let ringC = null;
    for (const c of S.convos) {
      const call = c.call;
      if (!call || dismissed.has(call.id) || (A && A.callId === call.id)) continue;
      if (call.people.includes(S.me.uid) || call.by === S.me.uid) continue;
      if (call.declined.includes(S.me.uid)) continue;
      if (now - call.startedAt > RING_MS || !call.people.length) continue;
      if (isDm(c) && iBlocked(otherOf(c))) continue;
      ringC = c;
      break;
    }
    if (ringC && !A) showRing(ringC);
    else if (ringing && (!ringC || ringC.call.id !== ringing.callId)) hideRing();
  }
  // o tempo de tocar acaba mesmo sem mudança nas conversas
  setInterval(onConvos, 5000);

  // fechar o app no meio da chamada: tenta avisar os outros
  window.addEventListener('pagehide', () => {
    if (A && A.callId) api.callLeave(A.cid, A.callId, S.me.uid).catch(() => {});
  });

  // ------------------------------------------------------------- partes da tela da conversa
  function headerButtons(c) {
    if (isDm(c) && iBlocked(otherOf(c))) return '';
    return `<button class="icon-btn" data-call="audio" aria-label="Chamada de voz" title="Chamada de voz">📞</button>
      <button class="icon-btn" data-call="video" aria-label="Chamada de vídeo" title="Chamada de vídeo">🎥</button>`;
  }

  function bar(c) {
    const call = c.call;
    if (!call || !call.people.length) return '';
    const inIt = A && A.callId === call.id;
    const n = call.people.length;
    return `<div class="call-bar"><span class="live-dot" aria-hidden="true"></span>
      <span>${call.kind === 'video' ? '🎥 Chamada de vídeo' : '📞 Chamada de voz'} acontecendo · ${n} pessoa${n === 1 ? '' : 's'}</span>
      <span class="grow"></span>
      ${inIt ? '<button class="btn small" data-call-open>Voltar para a chamada</button>' : `<button class="btn small primary" data-call-join>Entrar</button>`}</div>`;
  }

  function sysHtml(m) {
    const i = m.callInfo || {};
    const kind = i.kind === 'video' ? 'vídeo' : 'voz';
    const mineStart = i.starter === S.me.uid;
    const text = i.missed ? (mineStart ? `Chamada de ${kind} não atendida` : `Chamada de ${kind} perdida`) : `Chamada de ${kind} · ${fmt(i.dur || 0)}`;
    return `<div class="sys-msg ${i.missed && !mineStart ? 'missed' : ''}" data-mid="${esc(m.id)}"><span>${i.kind === 'video' ? '🎥' : '📞'} ${esc(text)}</span><time>${new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>`;
  }

  function handleClick(t, c) {
    const b = t.closest('[data-call]');
    if (b && c) {
      enter(c, b.dataset.call);
      return true;
    }
    if (t.closest('[data-call-join]') && c && c.call) {
      enter(c, c.call.kind, c.call.id);
      return true;
    }
    if (t.closest('[data-call-open]') && A) {
      A.min = false;
      drawScreen();
      return true;
    }
    return false;
  }

  return {
    onConvos,
    headerButtons,
    bar,
    sysHtml,
    handleClick,
    hangUp,
    get active() {
      return A;
    },
  };
}
