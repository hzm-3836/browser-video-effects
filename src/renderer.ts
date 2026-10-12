/**
 * Browser Video Effects — Copyright (c) 2026 EffectPop Contributors.
 * MIT licensed; see LICENSE. Selected media is decoded locally, without a network upload.
 */
export type EffectKind = 'most-likely-to' | 'pet-video' | 'freeze-frame' | 'beat-sync';
export type MediaAsset = {
  id: string;
  name: string;
  url: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  duration: number;
  source: HTMLImageElement | HTMLVideoElement;
};
export type RenderOptions = {
  kind: EffectKind;
  title: string;
  names: string[];
  winner: number;
  duration: number;
  ratio: '9:16' | '3:4' | '1:1';
  bpm: number;
  freezeAt: number;
  freezeDuration: number;
  shake: number;
};

const IMAGE_LIMIT = 12 * 1024 * 1024;
const VIDEO_LIMIT = 40 * 1024 * 1024;
const MAX_VIDEO_DURATION = 60;
const AUDIO_LIMIT = 20 * 1024 * 1024;
const MAX_ASSETS = 8;
const FPS = 24;
const MIME_TYPES = [
  'video/mp4;codecs=avc1.42001E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function validateMediaFile(file: Pick<File, 'name' | 'size' | 'type'>): 'image' | 'video' {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const image = ['jpg', 'jpeg', 'png', 'webp'].includes(extension ?? '') && (!file.type || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
  const video = ['mp4', 'webm', 'mov'].includes(extension ?? '') && (!file.type || ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type));
  if (!image && !video) throw new Error('Choose a JPG, PNG or WebP image, or an MP4, WebM or MOV video.');
  if (file.size <= 0) throw new Error('This file is empty. Choose another file.');
  if (file.size > (image ? IMAGE_LIMIT : VIDEO_LIMIT)) throw new Error(image ? 'Images must be 12 MB or smaller.' : 'Videos must be 40 MB or smaller.');
  return image ? 'image' : 'video';
}

function mediaReady(element: HTMLImageElement | HTMLVideoElement, ready: 'load' | 'loadeddata', action: () => void, timeout = 15000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Loading timed out. Try a smaller file.')), timeout);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      element.removeEventListener(ready, onReady);
      element.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    }
    function onReady() { finish(); }
    function onError() { finish(new Error('Your browser couldn’t read this file. Try a JPG image or an H.264 MP4 video.')); }
    element.addEventListener(ready, onReady, { once: true });
    element.addEventListener('error', onError, { once: true });
    action();
  });
}

async function readableVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration;
  // Browser-recorded WebM can omit duration metadata. Seeking past the allowed
  // input length asks the decoder for EOF, without an unbounded seek timestamp.
  const probeTime = MAX_VIDEO_DURATION + 1;
  const duration = await new Promise<number>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Determining the video length timed out. Try an H.264 MP4 or a smaller file.')), 5000);
    function finish(error?: Error, value?: number) {
      window.clearTimeout(timer);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      if (error) reject(error); else resolve(value!);
    }
    function onDurationChange() {
      if (Number.isFinite(video.duration)) finish(undefined, video.duration);
    }
    function onSeeked() {
      if (Number.isFinite(video.duration)) { finish(undefined, video.duration); return; }
      // Some decoders leave duration infinite but clamp a completed EOF seek to
      // the actual end. A seek that reaches the probe cannot prove a short file.
      const end = video.currentTime;
      if (Number.isFinite(end) && end > 0 && end < probeTime) finish(undefined, end);
      else finish(new Error('Your browser couldn’t determine this video’s length. Try an H.264 MP4 file.'));
    }
    function onError() { finish(new Error('Your browser couldn’t determine this video’s length. Try another file.')); }
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError, { once: true });
    try { video.currentTime = probeTime; } catch { finish(new Error('Your browser couldn’t seek to the end of this video. Try an H.264 MP4 file.')); }
  });
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION) throw new Error('Choose a video no longer than 60 seconds.');
  // Do not return an asset whose initial frame is still positioned at EOF.
  await seek(video, 0);
  return duration;
}

export async function loadAsset(file: File): Promise<MediaAsset> {
  const kind = validateMediaFile(file);
  const url = URL.createObjectURL(file);
  let source: HTMLImageElement | HTMLVideoElement | undefined;
  try {
    if (kind === 'image') {
      source = new Image();
      await mediaReady(source, 'load', () => { source!.src = url; });
      const image = source as HTMLImageElement;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('The image is too large or unreadable. Use an image up to 32 megapixels.');
      return { id: crypto.randomUUID(), name: file.name, url, kind, source, width: image.naturalWidth, height: image.naturalHeight, duration: 0 };
    }
    source = document.createElement('video');
    const video = source as HTMLVideoElement;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    await mediaReady(video, 'loadeddata', () => { video.src = url; video.load(); });
    const duration = await readableVideoDuration(video);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION) throw new Error('Choose a video no longer than 60 seconds.');
    if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > 32_000_000) throw new Error('The video dimensions are too large or unreadable. Try a smaller video.');
    return { id: crypto.randomUUID(), name: file.name, url, kind, source, width: video.videoWidth, height: video.videoHeight, duration };
  } catch (error) {
    if (source instanceof HTMLVideoElement) { source.pause(); source.removeAttribute('src'); source.load(); }
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function releaseAsset(asset: MediaAsset) {
  if (asset.source instanceof HTMLVideoElement) { asset.source.pause(); asset.source.removeAttribute('src'); asset.source.load(); }
  if (asset.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
  if (asset.source instanceof HTMLImageElement) asset.source.removeAttribute('src');
}

export function outputSize(ratio: RenderOptions['ratio']) {
  return { width: 540, height: ratio === '1:1' ? 540 : ratio === '3:4' ? 720 : 960 };
}

export function normalizedOptions(options: RenderOptions): RenderOptions {
  const duration = clamp(options.duration, 3, 30);
  return {
    ...options,
    title: (options.title ?? '').trim().slice(0, 100),
    names: (options.names ?? []).map((name) => name.trim().slice(0, 24)),
    duration,
    ratio: ['9:16', '3:4', '1:1'].includes(options.ratio) ? options.ratio : '9:16',
    winner: Math.max(0, Math.floor(options.winner || 0)),
    bpm: clamp(options.bpm, 40, 220),
    freezeAt: clamp(options.freezeAt, 0, duration - 0.25),
    freezeDuration: clamp(options.freezeDuration, 0.25, duration),
    shake: clamp(options.shake, 0, 1),
  };
}

/** Shared timing for preview and export. Freeze inserts a hold into source time. */
export function frameState(options: RenderOptions, time: number, assetCount: number) {
  const settings = normalizedOptions(options);
  const count = Math.max(1, assetCount);
  const t = clamp(time, 0, settings.duration);
  const beatDuration = 60 / settings.bpm;
  const beat = Math.floor(t / beatDuration);
  const freezeEnd = Math.min(settings.duration, settings.freezeAt + settings.freezeDuration);
  const frozen = t >= settings.freezeAt && t < freezeEnd;
  const reveal = t >= settings.duration * 0.65;
  const active = settings.kind === 'beat-sync' ? beat % count
    : settings.kind === 'pet-video' ? Math.min(count - 1, Math.floor(t / settings.duration * count))
      : settings.kind === 'most-likely-to' ? (reveal ? settings.winner % count : Math.floor(t / 0.22) % count) : 0;
  let sourceTime = t;
  if (settings.kind === 'freeze-frame') sourceTime = t < settings.freezeAt ? t : frozen ? settings.freezeAt : t - (freezeEnd - settings.freezeAt);
  if (settings.kind === 'beat-sync') sourceTime = t % beatDuration;
  if (settings.kind === 'pet-video') sourceTime = t - active * settings.duration / count;
  return { time: t, active, sourceTime, frozen, reveal, beat, beatPhase: (t % beatDuration) / beatDuration, progress: t / settings.duration };
}

export function motionOffset(options: RenderOptions, time: number) {
  const settings = normalizedOptions(options);
  const state = frameState(settings, time, 1);
  const pulse = Math.max(0, 1 - state.beatPhase * 4);
  const strength = settings.kind === 'freeze-frame' ? (state.frozen ? settings.shake * 20 : 0)
    : settings.kind === 'beat-sync' ? settings.shake * 20 * pulse : 0;
  if (!strength) return { x: 0, y: 0 };
  return { x: Math.sin(state.time * 67) * strength, y: Math.cos(state.time * 83) * strength * 0.6 };
}

async function seek(video: HTMLVideoElement, target: number, signal?: AbortSignal) {
  if (signal?.aborted) throw aborted();
  const duration = video.duration;
  const value = duration > 0 ? clamp(target, 0, Math.max(0, duration - 0.04)) : 0;
  if (!video.seeking && Math.abs(video.currentTime - value) < 0.016) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error('Seeking timed out. Try a smaller video.')), 3000);
    function done(error?: Error) {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    }
    function onSeeked() { done(); }
    function onError() { done(new Error('Couldn’t locate the video frame. Choose your file again.')); }
    function onAbort() { done(aborted()); }
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    try { video.currentTime = value; } catch { done(new Error('Your browser couldn’t seek within this video.')); }
  });
}

export async function prepareFrame(assets: MediaAsset[], options: RenderOptions, time: number, signal?: AbortSignal): Promise<void> {
  if (!assets.length) return;
  const state = frameState(options, time, assets.length);
  const visible = options.kind === 'most-likely-to' ? assets : [assets[state.active % assets.length]];
  await Promise.all(visible.filter((asset) => asset.kind === 'video').map((asset) => seek(asset.source as HTMLVideoElement, state.sourceTime % asset.duration, signal)));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function cover(ctx: CanvasRenderingContext2D, asset: MediaAsset, x: number, y: number, w: number, h: number, zoom = 1) {
  const scale = Math.max(w / asset.width, h / asset.height) * zoom;
  const dw = asset.width * scale, dh = asset.height * scale;
  ctx.drawImage(asset.source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, color = '#161919', lines = 3, align: CanvasTextAlign = 'left') {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const result: string[] = [];
  let line = '';
  // Keep words together, with character wrapping for long words and unspaced text.
  for (const token of value.match(/\n|[^\S\n]+|[^\s]+/gu) ?? []) {
    if (token === '\n') {
      result.push(line.trimEnd());
      line = '';
      continue;
    }
    if (/^\s+$/u.test(token)) {
      if (line) line += ' ';
      continue;
    }
    if (ctx.measureText(line + token).width <= width) {
      line += token;
      continue;
    }
    if (line.trimEnd()) result.push(line.trimEnd());
    line = '';
    for (const char of Array.from(token)) {
      if (line && ctx.measureText(line + char).width > width) {
        result.push(line);
        line = char;
      } else line += char;
    }
  }
  if (line) result.push(line.trimEnd());
  result.slice(0, lines).forEach((row, index) => {
    const suffix = index === lines - 1 && result.length > lines ? '…' : '';
    ctx.fillText(row + suffix, x, y + index * size * 1.22, width);
  });
}

function footer(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number, light = false) {
  ctx.fillStyle = light ? 'rgba(255,255,255,.25)' : '#d9ded5';
  ctx.fillRect(28, h - 38, w - 56, 4);
  ctx.fillStyle = '#d3fa88';
  ctx.fillRect(28, h - 38, (w - 56) * clamp(progress, 0, 1), 4);
}

export function renderFrame(canvas: HTMLCanvasElement, assets: MediaAsset[], rawOptions: RenderOptions, time: number): void {
  const options = normalizedOptions(rawOptions);
  const { width: w, height: h } = outputSize(options.ratio);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Your browser couldn’t create the video canvas.');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f4f4ed'; ctx.fillRect(0, 0, w, h);
  if (!assets.length) {
    text(ctx, 'Add media to start creating', w / 2, h * 0.44, w - 80, 26, '#161919', 2, 'center');
    ctx.restore(); return;
  }
  const safeAssets = assets.slice(0, MAX_ASSETS);
  const state = frameState(options, time, safeAssets.length);
  const active = safeAssets[state.active];
  if (options.kind === 'most-likely-to') {
    const titleY = 38;
    text(ctx, options.title || 'Who’s most likely to…?', 28, titleY, w - 56, h <= 540 ? 28 : 35, '#161919', 3);
    const columns = safeAssets.length <= 3 ? safeAssets.length : safeAssets.length <= 6 ? 3 : 4;
    const rows = Math.ceil(safeAssets.length / columns);
    const gap = 14;
    const areaY = h * 0.24, areaH = h * 0.50;
    const cardW = (w - 56 - gap * (columns - 1)) / columns;
    const cardH = (areaH - gap * (rows - 1)) / rows;
    safeAssets.forEach((asset, index) => {
      const x = 28 + (index % columns) * (cardW + gap), y = areaY + Math.floor(index / columns) * (cardH + gap);
      const selected = index === state.active;
      ctx.save();
      roundedRect(ctx, x, y, cardW, cardH, 14); ctx.clip();
      cover(ctx, asset, x, y, cardW, cardH, selected && state.reveal ? 1.08 : 1);
      ctx.fillStyle = 'rgba(10,16,13,.65)'; ctx.fillRect(x, y + cardH - 42, cardW, 42);
      text(ctx, options.names[index] || `Friend ${index + 1}`, x + 8, y + cardH - 29, cardW - 16, Math.min(18, cardW / 6), '#fff', 1);
      ctx.restore();
      if (selected) { roundedRect(ctx, x, y, cardW, cardH, 14); ctx.strokeStyle = '#89c642'; ctx.lineWidth = state.reveal ? 7 : 4; ctx.stroke(); }
    });
    text(ctx, state.reveal ? (options.names[state.active] || `Friend ${state.active + 1}`) : 'Who will it be?', w / 2, h * 0.80, w - 70, h <= 540 ? 24 : 30, '#161919', 1, 'center');
    footer(ctx, w, h, state.progress);
  } else if (options.kind === 'pet-video') {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const slideProgress = (state.time / options.duration * safeAssets.length) % 1;
    cover(ctx, active, 0, 0, w, h, 1 + slideProgress * 0.10);
    const gradient = ctx.createLinearGradient(0, h * 0.45, 0, h);
    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, 'rgba(10,16,13,.8)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    text(ctx, options.title || 'My best friend', 30, h * 0.73, w - 60, h <= 540 ? 32 : 42, '#fff', 2);
    ctx.font = '600 16px system-ui, sans-serif'; ctx.fillStyle = '#d3fa88'; ctx.textAlign = 'left';
    ctx.fillText(`${state.active + 1} / ${safeAssets.length}`, 30, h * 0.69);
    footer(ctx, w, h, state.progress, true); ctx.restore();
  } else if (options.kind === 'freeze-frame') {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const motion = motionOffset(options, state.time);
    ctx.translate(motion.x, motion.y);
    cover(ctx, active, -24, -24, w + 48, h + 48, state.frozen ? 1.07 : 1);
    ctx.restore();
    if (state.frozen) {
      ctx.fillStyle = 'rgba(9,15,13,.42)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d3fa88'; ctx.lineWidth = 5; ctx.strokeRect(22, 22, w - 44, h - 44);
      text(ctx, options.title || 'FREEZE', w / 2, h * 0.42, w - 80, h <= 540 ? 40 : 52, '#fff', 3, 'center');
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, h - 80, w, 80);
    }
    footer(ctx, w, h, state.progress, true);
  } else {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const pulse = Math.max(0, 1 - state.beatPhase * 4);
    const motion = motionOffset(options, state.time);
    ctx.save(); ctx.translate(motion.x, motion.y);
    cover(ctx, active, -24, -24, w + 48, h + 48, 1.01 + pulse * 0.06);
    ctx.restore();
    ctx.fillStyle = 'rgba(7,13,10,.6)'; ctx.fillRect(0, h * 0.72, w, h * 0.28);
    text(ctx, options.title || 'On the beat', 28, h * 0.76, w - 56, h <= 540 ? 28 : 37, '#fff', 2);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = state.beat % 4 === i ? '#d3fa88' : 'rgba(255,255,255,.3)'; roundedRect(ctx, 28 + i * 24, h * 0.70, 14, 6, 3); ctx.fill(); }
    footer(ctx, w, h, state.progress, true); ctx.restore();
  }
  ctx.restore();
}

function supportedMimeTypes(): string[] {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return [];
  return MIME_TYPES.filter((mime) => MediaRecorder.isTypeSupported(mime));
}

export function exportSupported(): boolean {
  return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && supportedMimeTypes().length > 0;
}

function aborted() { return new DOMException('Video export cancelled.', 'AbortError'); }

export async function exportVideo({ canvas, assets, options: rawOptions, audioFile, preparedAudioContext, signal, onProgress }: {
  canvas: HTMLCanvasElement;
  assets: MediaAsset[];
  options: RenderOptions;
  audioFile?: File;
  preparedAudioContext?: AudioContext;
  signal?: AbortSignal;
  onProgress?: (n: number) => void;
}): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; mimeType: string }> {
  if (!exportSupported()) throw new Error('This browser can’t export video. Try an up-to-date version of Chrome, Edge or Safari.');
  if (!assets.length || assets.length > MAX_ASSETS) throw new Error('Add 1–8 media files before exporting.');
  if (signal?.aborted) throw aborted();
  if (document.hidden) throw new Error('Keep this tab visible before starting an export.');
  const options = normalizedOptions(rawOptions);
  let audioContext: AudioContext | undefined;
  let audioSource: AudioBufferSourceNode | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: number | undefined;
  let animationFrame: number | undefined;
  let exportAborted = false;
  let abortReject: ((reason: Error) => void) | undefined;
  const seekController = new AbortController();
  const chunks: Blob[] = [];
  const abortPromise = new Promise<never>((_, reject) => { abortReject = reject; });
  // The rejection is also raced below; handle it while media preparation is pending.
  void abortPromise.catch(() => {});
  const cancel = () => {
    if (exportAborted) return;
    exportAborted = true;
    seekController.abort();
    if (timer !== undefined) window.clearTimeout(timer);
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    abortReject?.(aborted());
  };
  const visibilityChange = () => { if (document.hidden) cancel(); };
  signal?.addEventListener('abort', cancel, { once: true });
  document.addEventListener('visibilitychange', visibilityChange);
  const check = () => { if (exportAborted || signal?.aborted) throw aborted(); };
  try {
    if (audioFile) {
      if (audioFile.size <= 0 || audioFile.size > AUDIO_LIMIT) throw new Error('Choose a non-empty audio file up to 20 MB.');
      // Create/resume inside the button gesture, before the first asynchronous read.
      audioContext = preparedAudioContext ?? new AudioContext();
      const resumed = audioContext.resume();
      const audioDeadline = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Audio preparation timed out. Click Export again or remove the soundtrack and retry.')), 5000);
      });
      const [decoded] = await Promise.race([Promise.all([
        audioFile.arrayBuffer().then((buffer) => audioContext!.decodeAudioData(buffer)), resumed,
      ]), abortPromise, audioDeadline]);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (audioContext.state !== 'running') throw new Error('Your browser didn’t allow audio. Click Export again or remove the soundtrack.');
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = decoded;
      audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
    }
    check();
    await Promise.race([prepareFrame(assets, options, 0, seekController.signal), abortPromise]);
    check();
    renderFrame(canvas, assets, options, 0);
    stream = canvas.captureStream(FPS);
    if (!stream.getVideoTracks().length) throw new Error('Your browser couldn’t create a video track.');
    if (audioDestination) audioDestination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track));
    let mimeType = '';
    for (const candidate of supportedMimeTypes()) {
      try { recorder = new MediaRecorder(stream, { mimeType: candidate, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 }); mimeType = candidate; break; } catch { /* Try the next genuinely supported format. */ }
    }
    if (!recorder) throw new Error('Your browser couldn’t start video encoding. Try another browser.');
    const activeRecorder = recorder;
    const finished = new Promise<void>((resolve, reject) => {
      activeRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
      activeRecorder.addEventListener('stop', () => resolve(), { once: true });
      activeRecorder.addEventListener('error', () => reject(new Error('Video encoding failed. Try a shorter video.')), { once: true });
    });
    void finished.catch(() => {});
    activeRecorder.start(250);
    audioSource?.start(0, 0, Math.min(options.duration, audioSource.buffer?.duration ?? options.duration));
    const started = performance.now();
    onProgress?.(0);
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const draw = async () => {
          try {
            check();
            const elapsed = (performance.now() - started) / 1000;
            if (elapsed >= options.duration) { renderFrame(canvas, assets, options, options.duration - 0.001); onProgress?.(1); resolve(); return; }
            await prepareFrame(assets, options, elapsed, seekController.signal);
            check();
            renderFrame(canvas, assets, options, elapsed);
            onProgress?.(Math.min(0.99, elapsed / options.duration));
            // The browser records in real time; skipping delayed frames keeps duration honest.
            const delay = Math.max(0, 1000 / FPS - ((performance.now() - started) % (1000 / FPS)));
            timer = window.setTimeout(() => { animationFrame = window.requestAnimationFrame(() => { void draw(); }); }, delay);
          } catch (error) { reject(error); }
        };
        void draw();
      }),
      abortPromise,
      finished.then(() => { throw new Error('Recording ended early. Please export again.'); }),
    ]);
    check();
    activeRecorder.stop();
    await Promise.race([finished, abortPromise, new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Finishing the video timed out. Please export again.')), 10000); })]);
    check();
    const actualMime = activeRecorder.mimeType || mimeType;
    const blob = new Blob(chunks, { type: actualMime });
    if (blob.size < 1024) throw new Error('The exported file is incomplete. Please export again.');
    return { blob, extension: actualMime.startsWith('video/mp4') ? 'mp4' : 'webm', mimeType: actualMime };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (audioFile && error instanceof DOMException && ['EncodingError', 'NotSupportedError'].includes(error.name)) throw new Error('Your browser couldn’t decode this soundtrack. Try MP3 or WAV.');
    throw error;
  } finally {
    seekController.abort();
    signal?.removeEventListener('abort', cancel);
    document.removeEventListener('visibilitychange', visibilityChange);
    if (timer !== undefined) window.clearTimeout(timer);
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    try { audioSource?.stop(); } catch {}
    audioSource?.disconnect();
    audioDestination?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    audioDestination?.stream.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    assets.filter((asset) => asset.kind === 'video').forEach((asset) => (asset.source as HTMLVideoElement).pause());
  }
}
