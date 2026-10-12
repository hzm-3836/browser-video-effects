import { loadAsset, releaseAsset, prepareFrame, renderFrame, exportVideo, exportSupported, normalizedOptions } from '../dist/index.js';

const form = document.querySelector('#settings');
const fields = document.querySelector('#fields');
const canvas = document.querySelector('#preview');
const time = document.querySelector('#time');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const progress = document.querySelector('#progress');
const exportButton = document.querySelector('#export');
const cancelButton = document.querySelector('#cancel');
const resultVideo = document.querySelector('#result-video');
let assets = [];
let resultUrl = '';
let busy = false;
let controller;
let renderTask = Promise.resolve();
let previewVersion = 0;

function options() {
  const values = new FormData(form);
  return normalizedOptions({
    kind: values.get('kind'), title: String(values.get('title') || ''),
    names: String(values.get('names') || '').split(',').map((name) => name.trim()),
    winner: Number(values.get('winner')) - 1, duration: Number(values.get('duration')),
    ratio: values.get('ratio'), bpm: Number(values.get('bpm')),
    freezeAt: Number(values.get('freezeAt')), freezeDuration: Number(values.get('freezeDuration')),
    shake: Number(values.get('shake')),
  });
}
function setBusy(value, exporting = false) {
  busy = value;
  fields.disabled = value;
  time.disabled = value;
  exportButton.disabled = value || !assets.length || !exportSupported();
  cancelButton.hidden = !exporting;
  progress.hidden = !exporting;
}
function showError(cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; }
function clearError() { error.textContent = ''; error.hidden = true; }
function clearResult() {
  resultVideo.pause(); resultVideo.removeAttribute('src'); resultVideo.load();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = '';
  document.querySelector('#download').removeAttribute('href');
  document.querySelector('#result').hidden = true;
}
function preview() {
  if (busy) return;
  const version = ++previewVersion;
  const settings = options();
  time.max = String(settings.duration);
  time.value = String(Math.min(settings.duration, Number(time.value)));
  document.querySelector('#time-value').textContent = `${Number(time.value).toFixed(2)} seconds`;
  const currentAssets = assets;
  renderTask = renderTask.catch(() => {}).then(async () => {
    if (version !== previewVersion) return;
    await prepareFrame(currentAssets, settings, Number(time.value));
    if (version === previewVersion) renderFrame(canvas, currentAssets, settings, Number(time.value));
  });
  void renderTask.catch((cause) => { if (version === previewVersion) showError(cause); });
}
function syncFields() {
  const kind = form.elements.kind.value;
  document.querySelector('#freeze-settings').hidden = kind !== 'freeze-frame';
  document.querySelector('#bpm-label').hidden = kind !== 'beat-sync';
  document.querySelector('#shake-label').hidden = !['freeze-frame', 'beat-sync'].includes(kind);
  if (kind !== 'freeze-frame' && assets.some((asset) => asset.kind === 'video')) {
    assets.forEach(releaseAsset);
    assets = [];
    document.querySelector('#media').value = '';
    status.textContent = 'Select photos or use the sample illustrations for this effect.';
  }
  document.querySelector('#names-label').hidden = kind !== 'most-likely-to';
  document.querySelector('#winner-label').hidden = kind !== 'most-likely-to';
  if (kind === 'freeze-frame' && assets.length > 1) {
    const removed = assets.splice(1);
    removed.forEach(releaseAsset);
    status.textContent = 'Freeze Frame uses the first sample. Select one video to freeze real motion.';
  }
  document.querySelector('#files').textContent = assets.map((asset) => asset.name).join(' · ');
}
async function replaceFiles(files) {
  if (busy || !files.length) return;
  clearError(); clearResult(); setBusy(true);
  ++previewVersion;
  const next = [];
  try {
    const kind = form.elements.kind.value;
    if (files.length > 8 || (kind === 'freeze-frame' && files.length !== 1)) throw new Error(kind === 'freeze-frame' ? 'Select exactly one photo or video for Freeze Frame.' : 'Select up to eight photos.');
    await renderTask.catch(() => {});
    for (const file of files) {
      const asset = await loadAsset(file);
      next.push(asset);
      if (kind !== 'freeze-frame' && asset.kind !== 'image') throw new Error('Only Freeze Frame accepts videos in this demo. Select photos for the other effects.');
    }
    assets.forEach(releaseAsset);
    assets = next;
    syncFields();
    status.textContent = `Loaded ${assets.length} file${assets.length === 1 ? '' : 's'} locally. Keep the tab visible during export.`;
  } catch (cause) { next.forEach(releaseAsset); showError(cause); }
  finally { setBusy(false); preview(); }
}
async function sampleFiles() {
  const palette = [['#6bc4cd', '#19404e'], ['#f2be72', '#71362c'], ['#ad9ce4', '#3c325c']];
  const files = [];
  const count = form.elements.kind.value === 'freeze-frame' ? 1 : 3;
  for (let index = 0; index < count; index++) {
    const sample = document.createElement('canvas'); sample.width = 540; sample.height = 720;
    const ctx = sample.getContext('2d');
    ctx.fillStyle = palette[index][0]; ctx.fillRect(0, 0, 540, 720);
    ctx.fillStyle = palette[index][1]; ctx.beginPath(); ctx.arc(270, 285, 130, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f8f5ee'; ctx.beginPath(); ctx.arc(232, 265, 17, 0, Math.PI * 2); ctx.arc(308, 265, 17, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = '#f8f5ee'; ctx.beginPath(); ctx.arc(270, 300, 55, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = '#f8f5ee'; ctx.font = '700 30px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`Original sample ${index + 1}`, 270, 525);
    const blob = await new Promise((resolve, reject) => sample.toBlob((value) => value ? resolve(value) : reject(new Error('Sample generation failed.')), 'image/png'));
    files.push(new File([blob], `sample-${index + 1}.png`, { type: 'image/png' }));
  }
  return files;
}
document.querySelector('#media').addEventListener('change', (event) => { void replaceFiles(Array.from(event.target.files || [])); });
document.querySelector('#samples').addEventListener('click', () => { if (!busy) void sampleFiles().then(replaceFiles).catch(showError); });
document.querySelector('#kind').addEventListener('change', () => {
  ++previewVersion;
  clearResult(); clearError();
  // Wait until outstanding seeks finish before releasing media that a preview used.
  setBusy(true);
  void renderTask.catch(() => {}).then(() => {
    syncFields();
    const kind = form.elements.kind.value;
    form.elements.title.value = kind === 'freeze-frame' ? 'FREEZE' : kind === 'beat-sync' ? 'On the beat' : kind === 'pet-video' ? 'My best friend' : 'Who is most likely to dance?';
    setBusy(false); preview();
  });
});
form.addEventListener('input', (event) => {
  if (busy || ['media', 'audio'].includes(event.target.id)) return;
  clearResult(); clearError(); preview();
});
document.querySelector('#audio').addEventListener('change', clearResult);
time.addEventListener('input', preview);
cancelButton.addEventListener('click', () => controller?.abort());
exportButton.addEventListener('click', async () => {
  if (busy || !assets.length) return;
  if (!form.reportValidity()) return;
  // Disabled form fields are omitted by FormData, so capture settings before locking the UI.
  const settings = options();
  const audioFile = document.querySelector('#audio').files?.[0];
  if (audioFile && (audioFile.size <= 0 || audioFile.size > 20 * 1024 * 1024)) { showError(new Error('Choose a non-empty soundtrack up to 20 MB.')); return; }
  clearError(); clearResult(); controller = new AbortController();
  let audioContext;
  try {
    if (audioFile) {
      if (typeof AudioContext === 'undefined') throw new Error('This browser does not support AudioContext. Remove the soundtrack.');
      audioContext = new AudioContext(); void audioContext.resume().catch(() => {});
    }
    setBusy(true, true); ++previewVersion; progress.value = 0;
    status.textContent = 'Exporting in real time. Keep this tab visible.';
    await renderTask.catch(() => {});
    const result = await exportVideo({ canvas: document.createElement('canvas'), assets, options: settings, audioFile, preparedAudioContext: audioContext, signal: controller.signal, onProgress: (value) => { progress.value = value; } });
    resultUrl = URL.createObjectURL(result.blob);
    resultVideo.src = resultUrl;
    const download = document.querySelector('#download');
    download.href = resultUrl; download.download = `browser-video-effect.${result.extension}`;
    document.querySelector('#result-details').textContent = `${result.extension.toUpperCase()} · ${(result.blob.size / 1024 / 1024).toFixed(2)} MB · ${result.mimeType}`;
    document.querySelector('#result').hidden = false;
    status.textContent = 'Export complete. Play the result and download it below.';
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') status.textContent = 'Export cancelled. No partial video was saved.';
    else { showError(cause); status.textContent = 'Export did not complete.'; }
  } finally {
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    controller = undefined; setBusy(false); preview();
  }
});
window.addEventListener('pagehide', () => { controller?.abort(); clearResult(); assets.forEach(releaseAsset); });
syncFields();
if (!exportSupported()) status.textContent = 'Preview is available, but this browser cannot export. Try a current Chrome, Edge or Safari.';
void sampleFiles().then(replaceFiles).catch(showError);
