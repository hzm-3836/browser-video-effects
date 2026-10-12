# Browser Video Effects

Create short photo and video edits using **Canvas + MediaRecorder**, entirely in the browser. This is the original rendering core behind [EffectPop](https://effectpop.com/), with a plain JavaScript demo, typed APIs and resource-cleanup tests. There are no runtime dependencies, media uploads, accounts, analytics, advertisements or AI APIs in this repository.

**[Try Freeze Frame on EffectPop](https://effectpop.com/tools/freeze-frame?utm_source=github&utm_medium=readme&utm_campaign=browser_video_effects)** · **[Try Beat Sync](https://effectpop.com/tools/beat-sync?utm_source=github&utm_medium=readme&utm_campaign=browser_video_effects)** · [Photo Slideshow](https://effectpop.com/tools/pet-video) · [Friend Reveal](https://effectpop.com/tools/most-likely-to)

The hosted editors have their own [privacy policy](https://effectpop.com/privacy), hosting and optional advertising. This standalone demo does not include those integrations.

## What it does

| Preset | Behavior |
| --- | --- |
| `freeze-frame` | Freeze a selected video moment, insert a hold and then resume the source. Optionally add a caption and shake. |
| `beat-sync` | Cut between photos at a BPM you enter, with timed zoom and adjustable shake. |
| `pet-video` | Create a photo slideshow with a title and a separate soundtrack. The preset works with other subjects too. |
| `most-likely-to` | Animate a question and friend grid, revealing the answer selected by the user. |

These are original editing presets. They are not exact copies of CapCut templates. Beat Sync does not detect beats automatically, the slideshow does not generate new movement, and Friend Reveal does not infer answers with AI.

## Run the demo

Use **Node.js 22.13 or newer**, npm and a browser with Canvas support. From the repository root:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run dev
```

Open **http://127.0.0.1:8784/demo/**. Change the effect, select media, adjust a frame with the timeline and click **Export video**. Original geometric samples are generated locally, so no remote sample downloads are required. For a freeze of actual motion, select a video instead of the still-image sample.

The repository is not published on npm. `package.json` is marked private to prevent accidental publication. Build it locally or copy the MIT-licensed core into your application; do not assume an `npm install @effectpop/browser-video-effects` package exists.

## Minimal API example

After `npm run build`, `dist/index.js` and declarations are available. This example expects HTML inputs `#media`, a button `#export` and an anchor `#download`. Serve the page over HTTPS or localhost, then run this in an ES module:

```js
import { loadAsset, prepareFrame, renderFrame, exportVideo, releaseAsset } from './dist/index.js';

const settings = {
  kind: 'freeze-frame',
  title: 'FREEZE',
  names: [],
  winner: 0,
  duration: 6,
  ratio: '3:4',
  bpm: 120,
  freezeAt: 1,
  freezeDuration: 1.5,
  shake: 0.3,
};

const canvas = document.createElement('canvas');
document.body.append(canvas);
const exportButton = document.querySelector('#export');
let downloadUrl;

exportButton.addEventListener('click', async () => {
  if (exportButton.disabled) return;
  const file = document.querySelector('#media').files?.[0];
  if (!file) return;
  exportButton.disabled = true;
  let asset;
  try {
    asset = await loadAsset(file);
    await prepareFrame([asset], settings, 1.5);
    renderFrame(canvas, [asset], settings, 1.5);
    const result = await exportVideo({ canvas, assets: [asset], options: settings });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(result.blob);
    const link = document.querySelector('#download');
    link.href = downloadUrl;
    link.download = `freeze-frame.${result.extension}`;
    link.textContent = 'Download video';
  } catch (error) {
    console.error(error); // Show an accessible error message in your application.
  } finally {
    if (asset) releaseAsset(asset);
    exportButton.disabled = false;
  }
});
```

Do not run two exports against the same canvas or assets at once. The included demo disables settings during loading and recording and serializes preview seeks.

## API

| Export | Purpose |
| --- | --- |
| `loadAsset(file)` | Validate and decode a browser `File`; return a `MediaAsset` backed by an object URL. |
| `releaseAsset(asset)` | Pause media, release its source and revoke its object URL when no render still uses it. |
| `normalizedOptions(options)` | Clamp timing, BPM and shake; limit titles and names. |
| `frameState(options, time, assetCount)` | Calculate the active asset, freeze interval, source time and beat state. |
| `prepareFrame(assets, options, time, signal?)` | Seek visible video sources before rendering. |
| `renderFrame(canvas, assets, options, time)` | Draw a prepared frame into a canvas. It does not perform seeks. |
| `outputSize(ratio)` | Return the output dimensions for the selected aspect ratio. |
| `exportSupported()` | Check Canvas capture and a supported MediaRecorder MIME type. |
| `exportVideo({...})` | Record the timeline, returning `{ blob, extension, mimeType }`. |
| `validateMediaFile(file)` | Validate filename, declared MIME and byte limits before media decoding. |
| `motionOffset(options, time)` | Calculate deterministic shake offsets. |

`RenderOptions`, `MediaAsset` and `EffectKind` are exported TypeScript types. See [src/renderer.ts](src/renderer.ts) for their definitions.

`exportVideo` accepts `canvas`, `assets`, `options`, optional `audioFile`, optional `preparedAudioContext`, optional `signal` and optional `onProgress` (0 to 1). Use an `AbortController` for cancellation. If you supply audio, create and resume `AudioContext` in the user's button gesture **before** any asynchronous seek, then pass it as `preparedAudioContext`. The renderer closes the audio context after completion or failure. The demo shows this flow.

## Limits and browser behavior

- Up to **8** media assets. The demo accepts one photo or video for Freeze Frame and photos only for the other presets.
- JPG, PNG and WebP images up to **12 MB** and **32 megapixels**. No user-supplied SVG is decoded.
- MP4, WebM or MOV videos up to **40 MB**, **60 seconds** and **32 megapixels**, subject to browser decoding support.
- A separate decodable soundtrack up to **20 MB** may be added. Source-video audio is not retained. Preview is silent.
- Output is **540 × 960** (9:16), **540 × 720** (3:4) or **540 × 540** (1:1), at a nominal **24 fps**. Exports last **3–30 seconds**.
- MP4 is tried first, then WebM. The actual format is returned; changing the file extension does not convert a codec.
- Export runs in real time and cancels when the document becomes hidden. Keep the tab visible. Delayed frames can reduce the effective frame rate on slow devices.
- Source videos loop if source time exceeds input duration. Freeze inserts a hold inside the selected output length; it does not extend that length automatically.
- Recording, seeking and codecs vary by browser and device. `exportSupported()` does not promise that every selected file will decode. Use the local demo to check your target browser before shipping.
- This is a browser runtime, not a server-side video encoder. Pure timing functions are testable in Node; rendering needs DOM media APIs.

The automated tests cover source-time continuation, beat timing, validation, aspect ratios, line wrapping, cancellation, hidden-tab aborts, unsupported recording, empty/early recording and audio timeout cleanup. Browser export checks are separate from those controlled tests; see [COMPATIBILITY.md](COMPATIBILITY.md).

## Contributing

Useful contributions include reproducible codec reports, resource cleanup fixes, accessible editor examples and small original presets. State your browser version, device class, input format and observed result. Only attach media you have permission to make public. Run `npm run typecheck` and `npm test` before submitting a change.

## License

MIT © 2026 EffectPop Contributors. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Third-party user media and soundtracks are not covered by this license.
