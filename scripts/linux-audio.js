#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CABLE_DISPLAY_NAME = process.env.STARLING_CABLE_NAME ?? "Starling Cable";
const CABLE_SINK_NAME = process.env.STARLING_SINK_NAME ?? "starling_cable_sink";
const CABLE_SOURCE_NAME = process.env.STARLING_SOURCE_NAME ?? "starling_cable_source";
const STATE_DIR = path.join(os.homedir(), ".starling-cable");
const STATE_FILE = path.join(STATE_DIR, "state-linux.json");

function run(command, { quiet = false } = {}) {
  if (!quiet) {
    console.log(`> ${command}`);
  }

  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim?.() ?? "";
    const stdout = error?.stdout?.toString?.().trim?.() ?? "";
    const details = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(details || `Command failed: ${command}`);
  }
}

function commandExists(name) {
  try {
    run(`command -v ${name}`, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function ensureDependencies() {
  if (!commandExists("pactl")) {
    throw new Error(
      [
        "pactl is required but was not found.",
        "Install PulseAudio/PipeWire tools for your distro, then rerun this command.",
        "Examples:",
        "- Ubuntu/Debian: sudo apt install pulseaudio-utils",
        "- Fedora: sudo dnf install pulseaudio-utils",
        "- Arch: sudo pacman -S libpulse"
      ].join("\n")
    );
  }
}

function parseShortList(command) {
  const output = run(command, { quiet: true });
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        id: parts[0],
        name: parts[1],
        raw: line
      };
    });
}

function getDefaultSink() {
  try {
    return run("pactl get-default-sink", { quiet: true });
  } catch {
    const info = run("pactl info", { quiet: true });
    const line = info.split("\n").find((l) => l.startsWith("Default Sink:"));
    return line ? line.replace("Default Sink:", "").trim() : "";
  }
}

function getDefaultSource() {
  try {
    return run("pactl get-default-source", { quiet: true });
  } catch {
    const info = run("pactl info", { quiet: true });
    const line = info.split("\n").find((l) => l.startsWith("Default Source:"));
    return line ? line.replace("Default Source:", "").trim() : "";
  }
}

function saveState(data) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function readState() {
  if (!existsSync(STATE_FILE)) {
    return null;
  }

  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function deleteState() {
  if (existsSync(STATE_FILE)) {
    rmSync(STATE_FILE);
  }
}

function findModuleByArgFragment(fragment) {
  const modules = parseShortList("pactl list short modules");
  return modules.find((module) => module.raw.includes(fragment));
}

function findSink(name) {
  return parseShortList("pactl list short sinks").find((sink) => sink.name === name);
}

function findSource(name) {
  return parseShortList("pactl list short sources").find((source) => source.name === name);
}

function unloadModuleById(moduleId) {
  if (!moduleId) {
    return;
  }

  run(`pactl unload-module ${moduleId}`);
}

function ensureVirtualCableReady() {
  ensureDependencies();

  const existingSink = findSink(CABLE_SINK_NAME);
  let sinkModule = findModuleByArgFragment(`sink_name=${CABLE_SINK_NAME}`);
  if (!existingSink && !sinkModule) {
    const sinkModuleId = run(
      `pactl load-module module-null-sink sink_name=${CABLE_SINK_NAME} sink_properties=device.description=${JSON.stringify(CABLE_DISPLAY_NAME)}`,
      { quiet: true }
    );
    sinkModule = { id: sinkModuleId };
  }

  const existingSource = findSource(CABLE_SOURCE_NAME);
  let sourceModule = findModuleByArgFragment(`source_name=${CABLE_SOURCE_NAME}`);
  if (!existingSource && !sourceModule) {
    const sourceModuleId = run(
      `pactl load-module module-remap-source master=${CABLE_SINK_NAME}.monitor source_name=${CABLE_SOURCE_NAME} source_properties=device.description=${JSON.stringify(CABLE_DISPLAY_NAME + " Input")}`,
      { quiet: true }
    );
    sourceModule = { id: sourceModuleId };
  }

  const sink = findSink(CABLE_SINK_NAME);
  const source = findSource(CABLE_SOURCE_NAME);

  if (!sink || !source) {
    throw new Error(
      [
        "Failed to create or detect Starling virtual devices.",
        `Expected sink: ${CABLE_SINK_NAME}`,
        `Expected source: ${CABLE_SOURCE_NAME}`
      ].join("\n")
    );
  }

  return {
    sinkName: sink.name,
    sourceName: source.name,
    sinkModuleId: sinkModule?.id ?? findModuleByArgFragment(`sink_name=${CABLE_SINK_NAME}`)?.id,
    sourceModuleId: sourceModule?.id ?? findModuleByArgFragment(`source_name=${CABLE_SOURCE_NAME}`)?.id
  };
}

function install() {
  const devices = ensureVirtualCableReady();
  console.log(`Virtual cable ready for ${CABLE_DISPLAY_NAME}.`);
  console.log(`Detected sink  : ${devices.sinkName}`);
  console.log(`Detected source: ${devices.sourceName}`);
}

function start() {
  const devices = ensureVirtualCableReady();
  const previousSink = getDefaultSink();
  const previousSource = getDefaultSource();

  saveState({
    previousSink,
    previousSource,
    sinkName: devices.sinkName,
    sourceName: devices.sourceName,
    sinkModuleId: devices.sinkModuleId,
    sourceModuleId: devices.sourceModuleId
  });

  run(`pactl set-default-sink ${devices.sinkName}`);
  run(`pactl set-default-source ${devices.sourceName}`);

  console.log("Starling cable started.");
  console.log(`Default sink   -> ${devices.sinkName}`);
  console.log(`Default source -> ${devices.sourceName}`);
  console.log("Use npm run stop to restore previous devices.");
}

function stop() {
  ensureDependencies();

  const state = readState();
  if (!state) {
    console.log("No saved state found. Nothing to restore.");
    return;
  }

  try {
    if (state.previousSink && findSink(state.previousSink)) {
      run(`pactl set-default-sink ${state.previousSink}`);
    }

    if (state.previousSource && findSource(state.previousSource)) {
      run(`pactl set-default-source ${state.previousSource}`);
    }

    if (state.sourceModuleId) {
      unloadModuleById(state.sourceModuleId);
    }

    if (state.sinkModuleId) {
      unloadModuleById(state.sinkModuleId);
    }

    console.log("Audio devices restored.");
    console.log(`Default sink   -> ${state.previousSink || "(unchanged)"}`);
    console.log(`Default source -> ${state.previousSource || "(unchanged)"}`);
  } finally {
    deleteState();
  }
}

function status() {
  ensureDependencies();

  const currentSink = getDefaultSink();
  const currentSource = getDefaultSource();
  const sink = findSink(CABLE_SINK_NAME);
  const source = findSource(CABLE_SOURCE_NAME);

  console.log("Starling cable status");
  console.log(`Current sink   : ${currentSink || "(unknown)"}`);
  console.log(`Current source : ${currentSource || "(unknown)"}`);
  console.log(`${CABLE_DISPLAY_NAME} sink   : ${sink ? sink.name : "(not found)"}`);
  console.log(`${CABLE_DISPLAY_NAME} source : ${source ? source.name : "(not found)"}`);

  if (existsSync(STATE_FILE)) {
    console.log(`Saved state: ${STATE_FILE}`);
  } else {
    console.log("Saved state: none");
  }
}

function repair() {
  ensureDependencies();

  const existingSourceModule = findModuleByArgFragment(`source_name=${CABLE_SOURCE_NAME}`);
  const existingSinkModule = findModuleByArgFragment(`sink_name=${CABLE_SINK_NAME}`);

  if (existingSourceModule?.id) {
    unloadModuleById(existingSourceModule.id);
  }
  if (existingSinkModule?.id) {
    unloadModuleById(existingSinkModule.id);
  }

  const devices = ensureVirtualCableReady();
  console.log("Repair complete.");
  console.log(`Detected sink  : ${devices.sinkName}`);
  console.log(`Detected source: ${devices.sourceName}`);
}

function uninstall() {
  ensureDependencies();

  const sourceModule = findModuleByArgFragment(`source_name=${CABLE_SOURCE_NAME}`);
  const sinkModule = findModuleByArgFragment(`sink_name=${CABLE_SINK_NAME}`);

  if (sourceModule?.id) {
    unloadModuleById(sourceModule.id);
    console.log(`Unloaded source module ${sourceModule.id}.`);
  }

  if (sinkModule?.id) {
    unloadModuleById(sinkModule.id);
    console.log(`Unloaded sink module ${sinkModule.id}.`);
  }

  deleteState();
}

function main() {
  const command = process.argv[2] ?? "start";

  const actions = {
    install,
    start,
    stop,
    status,
    repair,
    uninstall
  };

  if (!actions[command]) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: node scripts/linux-audio.js [install|start|stop|status|repair|uninstall]");
    process.exit(1);
  }

  try {
    actions[command]();
  } catch (error) {
    console.error("Error:");
    console.error(error.message);
    process.exit(1);
  }
}

main();