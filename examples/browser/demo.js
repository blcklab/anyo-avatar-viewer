import { createSekai64AvatarViewer } from '@blcklab/anyo-avatar-viewer/browser';
const $ = id => document.getElementById(id);
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
try {
  const runtime = await createSekai64AvatarViewer({ canvas: $('canvas'), backend: 'webgl2', onDiagnostic(message) { $('diagnostic').textContent = message; } });
  const { viewer } = runtime;
  let clipsKey = '';
  const render = () => {
    const s = viewer.getSnapshot(), ready = s.phase === 'ready';
    $('model').disabled = s.phase === 'disposed'; $('animation').disabled = !ready;
    $('empty').style.display = s.model ? 'none' : 'grid';
    const key = s.clips.map(clip => clip.id).join('|');
    if (key !== clipsKey) {
      const selected = $('clip').value; clipsKey = key; $('clip').replaceChildren();
      if (!s.clips.length) $('clip').add(new Option('No animations loaded', ''));
      for (const clip of s.clips) $('clip').add(new Option(clip.name, clip.id));
      if (s.clips.some(clip => clip.id === selected)) $('clip').value = selected;
    }
    $('clip').disabled = !ready || !s.clips.length; $('play').disabled = $('clip').disabled;
    $('pause').disabled = !ready || !['playing','paused'].includes(s.status);
    $('stop').disabled = !ready || !s.clip; $('seek').disabled = !ready || !s.clip;
    $('speed').disabled = !ready; $('pause').textContent = s.status === 'paused' ? 'Resume' : 'Pause';
    $('seek').max = String(s.duration || 1); $('seek').value = String(s.time);
    $('time').textContent = `${s.time.toFixed(2)} s`; $('duration').textContent = `${s.duration.toFixed(2)} s`;
    if (s.error) status(s.error, true);
    else if (s.phase === 'loading') status('Loading avatar…');
    else if (s.loadingAnimations) status('Loading animation…');
    else if (!s.model) status('Ready. Choose your avatar.');
    else if (!s.clips.length) status('Avatar loaded. Add a compatible animation.');
    else status(`${s.clips.length} animation${s.clips.length === 1 ? '' : 's'} available · ${s.status}`);
  };
  const unsubscribe = viewer.subscribe(render); render();
  const run = callback => async () => { try { await callback(); } catch (error) { if (error.name !== 'AbortError') status(error.message, true); } };
  $('model').addEventListener('change', run(async () => {
    const file = $('model').files[0]; if (!file) return;
    $('diagnostic').textContent = '';
    const url = URL.createObjectURL(file);
    try { await viewer.loadModel({ url, format: file.name.toLowerCase().endsWith('.vrm') ? 'vrm' : 'glb' }); }
    finally { URL.revokeObjectURL(url); $('model').value = ''; }
  }));
  $('animation').addEventListener('change', run(async () => {
    const file = $('animation').files[0]; if (!file) return;
    $('diagnostic').textContent = '';
    const url = URL.createObjectURL(file);
    try { await viewer.loadAnimation({ url, format: file.name.toLowerCase().endsWith('.vrma') ? 'vrma' : 'glb' }); }
    finally { URL.revokeObjectURL(url); $('animation').value = ''; }
  }));
  $('play').addEventListener('click', run(() => viewer.play($('clip').value, { loop: $('loop').checked ? 'repeat' : 'once', speed: Number($('speed').value), fade: 0.25 })));
  $('pause').addEventListener('click', run(() => viewer.getSnapshot().status === 'paused' ? viewer.resume() : viewer.pause()));
  $('stop').addEventListener('click', run(() => viewer.stop()));
  $('seek').addEventListener('input', run(() => viewer.seek(Number($('seek').value))));
  $('speed').addEventListener('input', run(() => { const speed = Number($('speed').value); $('speedLabel').textContent = `${speed.toFixed(1)}×`; viewer.setSpeed(speed); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) runtime.stop(); else runtime.start(); });
  window.addEventListener('pagehide', () => { unsubscribe(); void runtime.dispose(); }, { once: true });
} catch (error) { status(`Could not start the viewer: ${error.message}`, true); }
