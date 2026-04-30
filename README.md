# Starling Cable (macOS + Linux)

Starling Cable provides a VB-Cable style workflow on macOS and Linux:

- On macOS, a virtual output and input are provided by BlackHole.
- On Linux, a virtual sink/source pair is created with `pactl` (PulseAudio/PipeWire).
- Node.js commands switch system audio defaults and restore previous values.
- One command starts routing apps to the virtual cable.

## Why this approach

Building a production-grade CoreAudio virtual driver from scratch is possible, but takes substantial low-level driver work and Apple code-signing setup. This project provides a practical, working path that starts and stops from Node.js while still giving you the same virtual cable behavior.

## Requirements

- macOS:
  - Node.js 18+
  - Homebrew
- Linux:
  - Node.js 18+
  - `pactl` available (PulseAudio/PipeWire tools)

## Custom name and device match

You can customize how the tool labels your cable and how devices are detected/created.

- STARLING_CABLE_NAME
  - Friendly label used in output messages and admin popup text.
- STARLING_DEVICE_MATCH
  - Substring used to detect input/output device names (default: BlackHole).
- STARLING_DRIVER_BUNDLE
  - HAL driver bundle name used for repair (default: BlackHole2ch.driver).
- STARLING_SINK_NAME
  - Linux sink name to create/use (default: starling_cable_sink).
- STARLING_SOURCE_NAME
  - Linux source name to create/use (default: starling_cable_source).

Examples:

STARLING_CABLE_NAME="Studio Cable" npm start

STARLING_CABLE_NAME="Studio Cable" STARLING_DEVICE_MATCH="Studio Cable" npm start

STARLING_CABLE_NAME="Studio Cable" STARLING_SINK_NAME="studio_sink" STARLING_SOURCE_NAME="studio_source" npm start

## Quick start

1. Install dependencies and activate the virtual cable:

  npm start

2. Check status:

   npm run status

3. Restore previous devices:

   npm run stop

## Commands

- npm run install
  - macOS: installs dependencies and auto-repairs if BlackHole is not visible.
  - Linux: verifies `pactl` and ensures the virtual sink/source exist.
- npm run repair
  - macOS: reinstalls dependencies if needed, clears problematic plugin attributes, and reloads CoreAudio using Apple admin popup.
  - Linux: reloads Starling sink/source modules.
- npm run start
  - Full automatic flow: detect/install/repair as needed, then save current devices and switch to your configured virtual cable device.
- npm run stop
  - Restores previous input/output devices from saved state.
- npm run status
  - Prints current devices and Starling virtual device detection state.
- npm run uninstall
  - macOS: uninstalls BlackHole and SwitchAudioSource.
  - Linux: unloads Starling sink/source modules.

## Notes

- After first BlackHole install, macOS may require logout/login before devices appear.
- If devices still do not appear after logout/login, npm start will auto-repair.
- npm run requires a script name by npm design. For a single command, use npm start.
- If your app should capture system audio, set that app output to BlackHole (macOS) or Starling sink (Linux).
- If you also want to hear the audio while routing, create a Multi-Output Device in Audio MIDI Setup that includes BlackHole and your speakers.
