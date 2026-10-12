import test from 'node:test';
import assert from 'node:assert/strict';
import { frameState, motionOffset, normalizedOptions, validateMediaFile, outputSize, exportSupported, exportVideo, prepareFrame, renderFrame, loadAsset } from '../dist/renderer.js';
const options = { kind: 'freeze-frame', title: 'Freeze', names: [], winner: 0, duration: 8, ratio: '9:16', bpm: 120, freezeAt: 2, freezeDuration: 1.5, shake: 0.4 };

test('freeze holds one source timestamp and resumes without skipping the held source segment', () => {
  const before = frameState(options, 1.9, 1);
  const heldA = frameState(options, 2, 1);
  const heldB = frameState(options, 3.49, 1);
  const resumed = frameState(options, 3.5, 1);
  assert.equal(before.sourceTime, 1.9);
  assert.equal(before.frozen, false);
  assert.equal(heldA.sourceTime, 2);
  assert.equal(heldB.sourceTime, 2);
  assert.equal(heldA.frozen, true);
  assert.equal(heldB.frozen, true);
  assert.equal(resumed.sourceTime, 2);
  assert.equal(resumed.frozen, false);
  assert.equal(frameState(options, 5, 1).sourceTime, 3.5);
});

test('freeze interval is clipped to output length and options cannot create non-finite timing', () => {
  const nearEnd = { ...options, freezeAt: 7, freezeDuration: 20 };
  assert.equal(frameState(nearEnd, 7.99, 1).frozen, true);
  assert.equal(frameState(nearEnd, 8, 1).frozen, false);
  const normalized = normalizedOptions({ ...options, duration: NaN, bpm: Infinity, freezeAt: -9, shake: 99 });
  assert.equal(normalized.duration, 3);
  assert.equal(normalized.bpm, 40);
  assert.equal(normalized.freezeAt, 0);
  assert.equal(normalized.shake, 1);
});

test('manual BPM changes the cut cadence and resets each source on a cut', () => {
  const beats = { ...options, kind: 'beat-sync' };
  assert.equal(frameState(beats, 0.49, 3).active, 0);
  assert.equal(frameState(beats, 0.5, 3).active, 1);
  assert.equal(frameState(beats, 1, 3).active, 2);
  assert.equal(frameState(beats, 1.5, 3).active, 0);
  assert.equal(frameState(beats, 1.5, 3).sourceTime, 0);
  assert.equal(frameState({ ...beats, bpm: 60 }, 0.5, 3).active, 0);
});

test('shake zero holds position, intensity scales movement, and beat shake fades between beats', () => {
  const beats = { ...options, kind: 'beat-sync' };
  assert.deepEqual(motionOffset({ ...beats, shake: 0 }, 0.06), { x: 0, y: 0 });
  const subtle = motionOffset({ ...beats, shake: 0.5 }, 0.06);
  const strong = motionOffset({ ...beats, shake: 1 }, 0.06);
  assert.ok(Math.abs(strong.x) > 0);
  assert.equal(strong.x, subtle.x * 2);
  assert.equal(strong.y, subtle.y * 2);
  assert.deepEqual(motionOffset(beats, 0.3), { x: 0, y: 0 });
  assert.deepEqual(motionOffset(options, 1), { x: 0, y: 0 });
});

test('friend reveal respects chosen winner and slideshow never indexes beyond the final asset', () => {
  const friend = { ...options, kind: 'most-likely-to', winner: 2 };
  assert.equal(frameState(friend, 5.19, 3).reveal, false);
  assert.equal(frameState(friend, 5.2, 3).reveal, true);
  assert.equal(frameState(friend, 7.99, 3).active, 2);
  assert.equal(frameState({ ...friend, winner: 9 }, 6, 3).active, 0);
  const pet = { ...options, kind: 'pet-video' };
  assert.equal(frameState(pet, 8, 3).active, 2);
  assert.equal(frameState(pet, 2.7, 3).active, 1);
});

test('input validation rejects oversized or empty files and disguised unsupported formats', () => {
  assert.equal(validateMediaFile({ name: 'photo.JPG', size: 1, type: 'image/jpeg' }), 'image');
  assert.equal(validateMediaFile({ name: 'clip.mov', size: 40 * 1024 * 1024, type: 'video/quicktime' }), 'video');
  assert.throws(() => validateMediaFile({ name: 'clip.mp4', size: 40 * 1024 * 1024 + 1, type: 'video/mp4' }), /40 MB/);
  assert.throws(() => validateMediaFile({ name: 'photo.png', size: 12 * 1024 * 1024 + 1, type: 'image/png' }), /12 MB/);
  assert.throws(() => validateMediaFile({ name: 'photo.png', size: 0, type: 'image/png' }), /empty/);
  assert.throws(() => validateMediaFile({ name: 'image.svg', size: 500, type: 'image/svg\+xml' }), /Choose/);
  assert.throws(() => validateMediaFile({ name: 'clip.mp4', size: 500, type: 'text/html' }), /Choose/);
});

test('output dimensions match each promised aspect ratio and unsupported server context stays false', () => {
  assert.deepEqual(outputSize('9:16'), { width: 540, height: 960 });
  assert.deepEqual(outputSize('3:4'), { width: 540, height: 720 });
  assert.deepEqual(outputSize('1:1'), { width: 540, height: 540 });
  assert.equal(exportSupported(), false);
});

function recorderHarness({ earlyStop = false, empty = false, fastAudioTimeout = false } = {}) {
  let time = 0;
  const stoppedTracks = [];
  const pending = new Set();
  const scheduledDelays = [];
  const drawnText = [];
  const nativeTimeout = globalThis.setTimeout;
  const context = new Proxy({}, { get: (_, key) => key === 'measureText' ? (value) => ({ width: Array.from(value).length * 9 }) : key === 'fillText' ? (text, x, y, width) => drawnText.push({ text, x, y, width }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
  const doc = new EventTarget(); doc.hidden = false;
  class Canvas {
    width = 540; height = 960;
    getContext() { return context; }
    captureStream() {
      const video = { kind: 'video', stop() { stoppedTracks.push(this); } };
      const tracks = [video];
      return { getVideoTracks: () => [video], getTracks: () => tracks, addTrack: (track) => tracks.push(track) };
    }
  }
  class Recorder extends EventTarget {
    static isTypeSupported(mime) { return mime === 'video/webm;codecs=vp8,opus'; }
    state = 'inactive';
    constructor(stream, settings) { super(); this.mimeType = settings.mimeType; }
    start() { this.state = 'recording'; if (earlyStop) queueMicrotask(() => this.stop()); }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      queueMicrotask(() => {
        const data = new Event('dataavailable'); data.data = new Blob([empty ? '' : new Uint8Array(4096)], { type: this.mimeType });
        this.dispatchEvent(data); this.dispatchEvent(new Event('stop'));
      });
    }
  }
  const values = {
    document: doc,
    MediaRecorder: Recorder,
    HTMLCanvasElement: Canvas,
    performance: { now: () => { time += 200; return time; } },
    window: {
      setTimeout(callback, delay) { scheduledDelays.push(delay); const handle = nativeTimeout(() => { pending.delete(handle); callback(); }, fastAudioTimeout && delay === 5000 ? 1 : delay > 1000 ? delay : 1); pending.add(handle); return handle; },
      clearTimeout(handle) { clearTimeout(handle); pending.delete(handle); },
      requestAnimationFrame(callback) { const handle = nativeTimeout(() => { pending.delete(handle); callback(); }, 1); pending.add(handle); return handle; },
      cancelAnimationFrame(handle) { clearTimeout(handle); pending.delete(handle); },
    },
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }));
  return {
    canvas: new Canvas(),
    assets: [{ kind: 'image', source: {}, width: 540, height: 960 }],
    doc, stoppedTracks, pending, scheduledDelays, drawnText,
    restore() { for (const handle of pending) clearTimeout(handle); Object.keys(values).forEach((key) => { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }); },
  };
}

test('canvas titles wrap English at word boundaries and still wrap long words and unspaced input', () => {
  const harness = recorderHarness();
  function titleLines(title, kind = 'most-likely-to') {
    harness.drawnText.length = 0;
    renderFrame(harness.canvas, harness.assets, { ...options, kind, title }, 0);
    return harness.drawnText.filter(({ x, y }) => x === 28 && y >= 38 && y < 150).map(({ text }) => text);
  }
  try {
    assert.deepEqual(titleLines('Every little moment with you becomes a beautiful memory'), ['Every little moment with you becomes a beautiful', 'memory']);
    assert.deepEqual(titleLines('A'.repeat(60)), ['A'.repeat(53), 'A'.repeat(7)]);
    const unspaced = '\u65c5\u884c'.repeat(35);
    const lines = titleLines(unspaced);
    assert.equal(lines.join(''), unspaced);
    assert.ok(lines.every(line => Array.from(line).length * 9 <= 484));
    harness.drawnText.length = 0;
    renderFrame(harness.canvas, harness.assets, { ...options, kind: 'pet-video', title: ['A'.repeat(29), 'B'.repeat(29), 'C'.repeat(29)].join(' ') }, 0);
    const petLines = harness.drawnText.filter(({ x, y }) => x === 30 && y >= 960 * 0.73 && y < 960 * 0.9).map(({ text }) => text);
    assert.equal(petLines.length, 2);
    assert.equal(petLines[1], 'B'.repeat(29) + '…');
  } finally { harness.restore(); }
});

test('video preparation seeks the selected freeze frame, then resumes, and cancellation clears a pending seek', async () => {
  const harness = recorderHarness();
  class Video extends EventTarget {
    duration = 8; seeking = false; value = 0; autoComplete = true; seeks = [];
    get currentTime() { return this.value; }
    set currentTime(value) { this.value = value; this.seeks.push(value); if (this.autoComplete) queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
  }
  const video = new Video();
  const assets = [{ kind: 'video', source: video, duration: 8 }];
  try {
    await prepareFrame(assets, options, 2.5);
    assert.equal(video.currentTime, 2);
    await prepareFrame(assets, options, 3.4);
    assert.deepEqual(video.seeks, [2]);
    await prepareFrame(assets, options, 4);
    assert.equal(video.currentTime, 2.5);
    const controller = new AbortController();
    video.autoComplete = false;
    const pendingSeek = prepareFrame(assets, options, 5, controller.signal);
    controller.abort();
    await assert.rejects(pendingSeek, { name: 'AbortError' });
    assert.equal(harness.pending.size, 0);
  } finally { harness.restore(); }
});

test('export uses actual supported MIME and stops tracks and scheduled work after completion', async () => {
  const harness = recorderHarness();
  try {
    const result = await exportVideo({ canvas: harness.canvas, assets: harness.assets, options: { ...options, kind: 'pet-video', duration: 3 } });
    assert.equal(result.extension, 'webm');
    assert.equal(result.mimeType, 'video/webm;codecs=vp8,opus');
    assert.equal(result.blob.size, 4096);
    assert.equal(harness.stoppedTracks.length, 1);
    assert.equal(harness.pending.size, 0);
  } finally { harness.restore(); }
});

test('cancel and hiding the tab reject export and release recording resources', async () => {
  for (const mode of ['cancel', 'hidden']) {
    const harness = recorderHarness();
    const controller = new AbortController();
    try {
      await assert.rejects(exportVideo({ canvas: harness.canvas, assets: harness.assets, options, signal: controller.signal, onProgress() {
        if (mode === 'cancel') controller.abort();
        else { harness.doc.hidden = true; harness.doc.dispatchEvent(new Event('visibilitychange')); }
      } }), { name: 'AbortError' });
      assert.equal(harness.stoppedTracks.length, 1);
      assert.equal(harness.pending.size, 0);
    } finally { harness.restore(); }
  }
});

test('premature recorder stop and empty encoding never return a success file', async () => {
  for (const settings of [{ earlyStop: true }, { empty: true }]) {
    const harness = recorderHarness(settings);
    try {
      await assert.rejects(exportVideo({ canvas: harness.canvas, assets: harness.assets, options: { ...options, duration: 3 } }), settings.earlyStop ? /ended early/ : /incomplete/);
      assert.equal(harness.stoppedTracks.length, 1);
      assert.equal(harness.pending.size, 0);
    } finally { harness.restore(); }
  }
});

function suspendedAudioContext() {
  return {
    state: 'suspended', resumes: 0, closes: 0,
    resume() { this.resumes += 1; return new Promise(() => {}); },
    decodeAudioData() { return Promise.resolve({ duration: 3 }); },
    close() { this.closes += 1; this.state = 'closed'; return Promise.resolve(); },
  };
}

test('a suspended audio resume hits its bounded timeout and closes the prepared AudioContext', async () => {
  const harness = recorderHarness({ fastAudioTimeout: true });
  const audio = suspendedAudioContext();
  try {
    await assert.rejects(exportVideo({ canvas: harness.canvas, assets: harness.assets, options, preparedAudioContext: audio, audioFile: { size: 4, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } }), /Audio preparation timed out/);
    assert.equal(audio.resumes, 1);
    assert.equal(audio.closes, 1);
    assert.equal(audio.state, 'closed');
    assert.ok(harness.scheduledDelays.includes(5000));
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.stoppedTracks.length, 0);
  } finally { harness.restore(); }
});

test('cancelling while audio resume is suspended closes AudioContext and clears the timeout', async () => {
  const harness = recorderHarness();
  const audio = suspendedAudioContext();
  const controller = new AbortController();
  try {
    const exporting = exportVideo({ canvas: harness.canvas, assets: harness.assets, options, preparedAudioContext: audio, audioFile: { size: 4, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }, signal: controller.signal });
    queueMicrotask(() => controller.abort());
    await assert.rejects(exporting, { name: 'AbortError' });
    assert.equal(audio.resumes, 1);
    assert.equal(audio.closes, 1);
    assert.equal(audio.state, 'closed');
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.stoppedTracks.length, 0);
  } finally { harness.restore(); }
});

function videoLoadingHarness({ initial = Infinity, actual = 8, revealDuration = true, stalled = false, resetStalled = false, decoderError = false } = {}) {
  const pending = new Set();
  const revoked = [];
  const videos = [];
  const nativeTimeout = globalThis.setTimeout;
  class Video extends EventTarget {
    duration = initial; videoWidth = 540; videoHeight = 720;
    seeking = false; value = 0; src = ''; seeks = []; pauses = 0; removed = 0;
    listeners = new Map();
    addEventListener(name, callback, options) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
      super.addEventListener(name, callback, options);
    }
    removeEventListener(name, callback, options) {
      this.listeners.get(name)?.delete(callback);
      super.removeEventListener(name, callback, options);
    }
    get currentTime() { return this.value; }
    set currentTime(value) {
      this.seeks.push(value); this.seeking = true;
      if ((value > 0 && stalled) || (value === 0 && resetStalled)) return;
      queueMicrotask(() => {
        if (decoderError) { this.dispatchEvent(new Event('error')); return; }
        this.value = Math.min(value, actual); this.seeking = false;
        if (value > 0 && revealDuration) { this.duration = actual; this.dispatchEvent(new Event('durationchange')); }
        this.dispatchEvent(new Event('seeked'));
      });
    }
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
    pause() { this.pauses += 1; }
    removeAttribute(name) { if (name === 'src') { this.src = ''; this.removed += 1; } }
  }
  const values = {
    document: { createElement(name) { assert.equal(name, 'video'); const video = new Video(); videos.push(video); return video; } },
    HTMLVideoElement: Video,
    URL: { createObjectURL() { return 'blob:duration-test'; }, revokeObjectURL(value) { revoked.push(value); } },
    window: {
      setTimeout(callback, delay) {
        const handle = nativeTimeout(() => { pending.delete(handle); callback(); }, [3000, 5000].includes(delay) ? 1 : delay);
        pending.add(handle); return handle;
      },
      clearTimeout(handle) { clearTimeout(handle); pending.delete(handle); },
    },
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }));
  return {
    file: { name: 'recorded.webm', size: 2048, type: 'video/webm' },
    videos, pending, revoked,
    listenerCount() { return videos.reduce((sum, video) => sum + [...video.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0); },
    restore() {
      for (const handle of pending) clearTimeout(handle);
      Object.keys(values).forEach((key) => { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; });
    },
  };
}

test('a video with finite metadata keeps the original no-probe loading path', async () => {
  const harness = videoLoadingHarness({ initial: 8 });
  try {
    const asset = await loadAsset(harness.file);
    assert.equal(asset.duration, 8);
    assert.equal(asset.source.currentTime, 0);
    assert.deepEqual(harness.videos[0].seeks, []);
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.listenerCount(), 0);
    assert.deepEqual(harness.revoked, []);
  } finally { harness.restore(); }
});

test('unknown video duration is recovered from EOF and the accepted asset returns to frame zero', async () => {
  for (const settings of [{}, { revealDuration: false }, { actual: 60 }]) {
    const harness = videoLoadingHarness(settings);
    try {
      const asset = await loadAsset(harness.file);
      assert.equal(asset.duration, settings.actual ?? 8);
      assert.equal(asset.source.currentTime, 0);
      assert.equal(harness.videos[0].seeks.length, 2);
      assert.ok(harness.videos[0].seeks[0] > 60);
      assert.equal(harness.videos[0].seeks[1], 0);
      assert.equal(harness.pending.size, 0);
      assert.equal(harness.listenerCount(), 0);
      assert.deepEqual(harness.revoked, []);
    } finally { harness.restore(); }
  }
});

test('duration recovery never bypasses the real 60-second input limit', async () => {
  for (const settings of [{ initial: 90, actual: 90 }, { actual: 90 }, { actual: 60.001 }, { actual: 90, revealDuration: false }]) {
    const harness = videoLoadingHarness(settings);
    try {
      await assert.rejects(loadAsset(harness.file), /60 seconds|determine.*length/u);
      assert.equal(harness.pending.size, 0);
      assert.equal(harness.listenerCount(), 0);
      assert.equal(harness.videos[0].pauses, 1);
      assert.equal(harness.videos[0].removed, 1);
      assert.deepEqual(harness.revoked, ['blob:duration-test']);
    } finally { harness.restore(); }
  }
});

test('duration probe timeout, decoder failure and stalled reset release every listener, timer and object URL', async () => {
  for (const settings of [{ stalled: true }, { decoderError: true }, { resetStalled: true }]) {
    const harness = videoLoadingHarness(settings);
    try {
      await assert.rejects(loadAsset(harness.file), /timed out|determine.*length/u);
      assert.equal(harness.pending.size, 0);
      assert.equal(harness.listenerCount(), 0);
      assert.equal(harness.videos[0].pauses, 1);
      assert.equal(harness.videos[0].removed, 1);
      assert.deepEqual(harness.revoked, ['blob:duration-test']);
    } finally { harness.restore(); }
  }
});

