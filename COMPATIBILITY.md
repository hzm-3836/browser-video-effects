# Compatibility observations

The renderer checks `Canvas.captureStream` and actual `MediaRecorder.isTypeSupported` values at runtime. The demo displays a preview-only message when export is unavailable. No all-browser support guarantee is implied.

The initial standalone release is verified with an independent TypeScript build and the renderer's controlled Node tests. These tests simulate recording and audio failures to check timing and cleanup; they do not measure real browser codecs or speed.

## Browser check on October 13, 2026

The standalone demo was exercised in the Chromium-based Codex in-app browser on a Windows workspace. The exact browser version was not available from the testing surface. An original 8-second VP8 WebM recorded with Canvas and MediaRecorder was selected; this file initially reports an unknown duration, so it also exercised bounded EOF duration recovery. Freeze Frame held the source from 1 second for 1.5 seconds, using a 6-second, 3:4 output.

The returned format was `video/mp4;codecs=avc1.42001f`. The exported video decoded without an error: **540 × 720**, **5.998 seconds**, ready state **4**, approximately **0.45 MB**. The download control produced a real MP4 file. This is a standalone-core result, separate from the hosted React editor. Source-video audio was not retained; no separate soundtrack was selected.

The automated suite contains **23 passing tests**, including bounded duration recovery and demo server path boundaries. No physical iPhone, Safari, Android device, or all-browser compatibility claim follows from this one browser check. Mobile viewport checks of the hosted site are layout checks, not physical-device encoder tests. Files with unsupported codecs still fail with an error; duration recovery does not bypass the 60-second input limit.

To reproduce a browser check:

1. Run `npm ci --ignore-scripts`, `npm test` and `npm run dev`.
2. Open the demo, keep its tab visible and export a 6-second 3:4 original sample.
3. Check the actual returned MIME type, playable output duration and video dimensions.
4. Repeat with a short video for Freeze Frame, with an optional separate soundtrack and then with cancellation.
5. Report the browser version, OS/device, input format, preset and observed result. A format accepted by the file picker can still be unsupported by a browser decoder.
