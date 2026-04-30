# Starling Cable (macOS + Linux)

Starling Cable provides a VB-Cable style workflow on macOS and Linux:

- On macOS, a virtual output and input are provided by BlackHole.
- On Linux, a virtual sink/source pair is created with `pactl` (PulseAudio/PipeWire).
- Node.js commands switch system audio defaults and restore previous values.
- One command starts routing apps to the virtual cable.
- Devices can connect peer-to-peer by IP and forward audio to each other.

## Why this approach

Building a production-grade CoreAudio virtual driver from scratch is possible, but takes substantial low-level driver work and Apple code-signing setup. This project provides a practical, working path that starts and stops from Node.js while still giving you the same virtual cable behavior.

## Requirements

- macOS:
  - Node.js 18+
  - Homebrew
  - `ffmpeg` with `ffplay` for network forwarding (auto-installed by `npm run connect`)
- Linux:
  - Node.js 18+
  - `pactl` available (PulseAudio/PipeWire tools)
  - `ffmpeg` with `ffplay` for network forwarding

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

STARLING_FORWARD_PORT="4010" npm run connect -- 192.168.1.42

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
- npm run connect -- <peer-ip>
  - Starts a two-way forwarding session to another device running the same command.
- npm run disconnect
  - Stops the forwarding session.
- npm run forward-status
  - Shows forwarding process status, peer IP, and log file path.
- npm run uninstall
  - macOS: uninstalls BlackHole and SwitchAudioSource.
  - Linux: unloads Starling sink/source modules.

## Peer forwarding

Run this on both devices, replacing the IP with the other device's reachable address:

1. npm start
2. npm run connect -- 192.168.x.x

What it does:

- Captures audio from the Starling virtual input/source.
- Streams it to the peer over TCP.
- Plays received peer audio on the local default speaker output.

Current behavior:

- This is point-to-point: one peer per device.
- If a device already plays its own local audio through speakers, you will hear both local audio and remote forwarded audio there.
- If local output is still set to the virtual cable, only the received peer audio is guaranteed to be audible locally.

## Notes

- After first BlackHole install, macOS may require logout/login before devices appear.
- If devices still do not appear after logout/login, npm start will auto-repair.
- npm run requires a script name by npm design. For a single command, use npm start.
- If your app should capture system audio, set that app output to BlackHole (macOS) or Starling sink (Linux).
- If you also want to hear the audio while routing, create a Multi-Output Device in Audio MIDI Setup that includes BlackHole and your speakers.
