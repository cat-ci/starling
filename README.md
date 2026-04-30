# Starling Cable (macOS)

Starling Cable provides a VB-Cable style workflow on macOS:

- A virtual output device and input device are provided by BlackHole.
- Node.js commands install dependencies and switch macOS audio devices.
- One command starts routing apps to the virtual cable.
- If repair is needed, macOS shows the native administrator password popup.

## Why this approach

Building a production-grade CoreAudio virtual driver from scratch is possible, but takes substantial low-level driver work and Apple code-signing setup. This project provides a practical, working path that starts and stops from Node.js while still giving you the same virtual cable behavior.

## Requirements

- macOS
- Node.js 18+
- Homebrew

## Custom name and device match

You can customize how the tool labels your cable and what device name it looks for.

- STARLING_CABLE_NAME
  - Friendly label used in output messages and admin popup text.
- STARLING_DEVICE_MATCH
  - Substring used to detect input/output device names (default: BlackHole).
- STARLING_DRIVER_BUNDLE
  - HAL driver bundle name used for repair (default: BlackHole2ch.driver).

Examples:

STARLING_CABLE_NAME="Studio Cable" npm start

STARLING_CABLE_NAME="Studio Cable" STARLING_DEVICE_MATCH="Studio Cable" npm start

## Quick start

1. Install dependencies and activate the virtual cable:

  npm start

2. Check status:

   npm run status

3. Restore previous devices:

   npm run stop

## Commands

- npm run install
  - Installs dependencies and auto-repairs if BlackHole is not visible.
- npm run repair
  - Reinstalls dependencies if needed, clears problematic plugin attributes, and reloads CoreAudio using Apple admin popup.
- npm run start
  - Full automatic flow: detect/install/repair as needed, then save current devices and switch to your configured virtual cable device.
- npm run stop
  - Restores previous input/output devices from saved state.
- npm run status
  - Prints current devices and BlackHole detection state.
- npm run uninstall
  - Uninstalls BlackHole and SwitchAudioSource.

## Notes

- After first BlackHole install, macOS may require logout/login before devices appear.
- If devices still do not appear after logout/login, npm start will auto-repair.
- npm run requires a script name by npm design. For a single command, use npm start.
- If your app should capture system audio, set that app output to BlackHole.
- If you also want to hear the audio while routing, create a Multi-Output Device in Audio MIDI Setup that includes BlackHole and your speakers.
