#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEVICE_MATCH = process.env.STARLING_DEVICE_MATCH ?? "BlackHole";
const CABLE_DISPLAY_NAME = process.env.STARLING_CABLE_NAME ?? "Starling Cable";
const DRIVER_BUNDLE_NAME = process.env.STARLING_DRIVER_BUNDLE ?? "BlackHole2ch.driver";
const FORWARD_PORT = Number(process.env.STARLING_FORWARD_PORT ?? "4010");
const STATE_DIR = path.join(os.homedir(), ".starling-cable");
const STATE_FILE = path.join(STATE_DIR, "state-macos.json");
const FORWARD_STATE_FILE = path.join(STATE_DIR, "forward-macos.json");
const FORWARD_LOG_FILE = path.join(STATE_DIR, "forward-macos.log");
const FORWARD_SCRIPT = path.join(__dirname, "audio-forwarder.js");

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

function runPrivileged(shellCommand, prompt) {
  const appleScript = `do shell script ${JSON.stringify(shellCommand)} with administrator privileges with prompt ${JSON.stringify(prompt)}`;
  return run(`osascript -e ${JSON.stringify(appleScript)}`);
}

function commandExists(name) {
  try {
    run(`command -v ${name}`, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function ensureBrew() {
  if (!commandExists("brew")) {
    throw new Error(
      "Homebrew is required. Install from https://brew.sh, then rerun this command."
    );
  }
}

function ensurePackageInstalled(formulaOrCask, { cask = false } = {}) {
  const check = cask ? `brew list --cask ${formulaOrCask}` : `brew list ${formulaOrCask}`;
  const install = cask ? `brew install --cask ${formulaOrCask}` : `brew install ${formulaOrCask}`;

  try {
    run(check, { quiet: true });
    console.log(`Already installed: ${formulaOrCask}`);
  } catch {
    console.log(`Installing: ${formulaOrCask}`);
    run(install);
  }
}

function ensureDependencies() {
  ensureBrew();
  ensurePackageInstalled("blackhole-2ch", { cask: true });
  ensurePackageInstalled("switchaudio-osx", { cask: false });
}

function ensureForwardingDependencies() {
  ensureDependencies();

  if (!commandExists("ffmpeg") || !commandExists("ffplay")) {
    ensurePackageInstalled("ffmpeg", { cask: false });
  }

  if (!commandExists("ffmpeg") || !commandExists("ffplay")) {
    throw new Error("ffmpeg and ffplay are required for forwarding but were not found after installation.");
  }
}

function getAudioSources(type) {
  const output = run(`SwitchAudioSource -a -t ${type}`, { quiet: true });
  return output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getCurrentAudioSource(type) {
  return run(`SwitchAudioSource -c -t ${type}`, { quiet: true });
}

function setAudioSource(type, name) {
  run(`SwitchAudioSource -s ${JSON.stringify(name)} -t ${type}`);
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

function saveForwardState(data) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FORWARD_STATE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function readForwardState() {
  if (!existsSync(FORWARD_STATE_FILE)) {
    return null;
  }

  return JSON.parse(readFileSync(FORWARD_STATE_FILE, "utf8"));
}

function deleteForwardState() {
  if (existsSync(FORWARD_STATE_FILE)) {
    rmSync(FORWARD_STATE_FILE);
  }
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findVirtualCableName() {
  const inputs = getAudioSources("input");
  const outputs = getAudioSources("output");

  const inputMatch = inputs.find((n) => n.includes(DEVICE_MATCH));
  const outputMatch = outputs.find((n) => n.includes(DEVICE_MATCH));

  if (!inputMatch || !outputMatch) {
    const allDevicesJson = run("SwitchAudioSource -a -t all -f json", { quiet: true });
    throw new Error(
      [
        `Virtual cable devices matching \"${DEVICE_MATCH}\" were not found.`,
        "If you already logged out/in, run: npm run repair",
        "Detected devices:",
        allDevicesJson || "(none)"
      ].join("\n")
    );
  }

  if (inputMatch !== outputMatch) {
    console.log(`Using output ${outputMatch} and input ${inputMatch}`);
  }

  return {
    inputName: inputMatch,
    outputName: outputMatch
  };
}

function repair() {
  ensureDependencies();

  // Remove stale filesystem attributes that can prevent CoreAudio from loading HAL plugins.
  runPrivileged(
    `xattr -dr com.dropbox.attrs /Library/Audio/Plug-Ins/HAL/${DRIVER_BUNDLE_NAME} || true`,
    `${CABLE_DISPLAY_NAME} needs admin access to repair virtual audio driver loading.`
  );
  runPrivileged(
    `xattr -dr com.apple.provenance /Library/Audio/Plug-Ins/HAL/${DRIVER_BUNDLE_NAME} || true`,
    `${CABLE_DISPLAY_NAME} needs admin access to repair virtual audio driver loading.`
  );
  runPrivileged(
    "killall coreaudiod",
    `${CABLE_DISPLAY_NAME} needs admin access to reload macOS audio services.`
  );

  const devices = findVirtualCableName();
  console.log("Repair complete.");
  console.log(`Detected input: ${devices.inputName}`);
  console.log(`Detected output: ${devices.outputName}`);
}

function ensureVirtualCableReady() {
  ensureDependencies();

  try {
    return findVirtualCableName();
  } catch {
    console.log(`No virtual cable matching \"${DEVICE_MATCH}\" was detected. Running automatic repair...`);
    repair();
    return findVirtualCableName();
  }
}

function install() {
  const devices = ensureVirtualCableReady();
  console.log(`Virtual cable ready for ${CABLE_DISPLAY_NAME}.`);
  console.log(`Detected input: ${devices.inputName}`);
  console.log(`Detected output: ${devices.outputName}`);
}

function start() {
  const devices = ensureVirtualCableReady();

  const previousInput = getCurrentAudioSource("input");
  const previousOutput = getCurrentAudioSource("output");
  const { inputName, outputName } = devices;

  saveState({ previousInput, previousOutput, inputName, outputName });

  setAudioSource("output", outputName);
  setAudioSource("input", inputName);

  console.log("Starling cable started.");
  console.log(`System output -> ${outputName}`);
  console.log(`System input  -> ${inputName}`);
  console.log("Use npm run stop to restore previous devices.");
}

function disconnectForwarding({ quiet = false } = {}) {
  const state = readForwardState();

  if (!state) {
    if (!quiet) {
      console.log("No forwarding session is running.");
    }
    return;
  }

  try {
    if (state.pid) {
      process.kill(state.pid, "SIGTERM");
    }
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  } finally {
    deleteForwardState();
  }

  if (!quiet) {
    console.log("Forwarding stopped.");
  }
}

function connect(peerHost) {
  if (!peerHost) {
    throw new Error("Usage: npm run connect -- <peer-ip>");
  }

  ensureForwardingDependencies();
  const devices = ensureVirtualCableReady();
  disconnectForwarding({ quiet: true });

  mkdirSync(STATE_DIR, { recursive: true });
  const logFd = openSync(FORWARD_LOG_FILE, "a");
  const child = spawn(
    process.execPath,
    [
      FORWARD_SCRIPT,
      "run",
      "--platform",
      "darwin",
      "--capture-device",
      devices.inputName,
      "--peer-host",
      peerHost,
      "--peer-port",
      String(FORWARD_PORT),
      "--listen-port",
      String(FORWARD_PORT)
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd]
    }
  );

  child.unref();

  saveForwardState({
    pid: child.pid,
    peerHost,
    port: FORWARD_PORT,
    captureDevice: devices.inputName,
    logFile: FORWARD_LOG_FILE,
    startedAt: new Date().toISOString()
  });

  console.log(`Forwarding started with peer ${peerHost}:${FORWARD_PORT}.`);
  console.log("Remote audio will play on this Mac's current default output.");
}

function forwardStatus() {
  const state = readForwardState();
  console.log("Starling forwarding status");

  if (!state) {
    console.log("Session: not running");
    return;
  }

  console.log(`Session: ${isProcessRunning(state.pid) ? "running" : "stopped"}`);
  console.log(`Peer   : ${state.peerHost}:${state.port}`);
  console.log(`Capture: ${state.captureDevice}`);
  console.log(`Log    : ${state.logFile}`);
}

function stop() {
  disconnectForwarding({ quiet: true });
  const state = readState();

  if (!state) {
    console.log("No saved state found. Nothing to restore.");
    return;
  }

  try {
    if (state.previousOutput) {
      setAudioSource("output", state.previousOutput);
    }

    if (state.previousInput) {
      setAudioSource("input", state.previousInput);
    }

    console.log("Audio devices restored.");
    console.log(`System output -> ${state.previousOutput}`);
    console.log(`System input  -> ${state.previousInput}`);
  } finally {
    deleteState();
  }
}

function status() {
  ensureBrew();

  const hasSwitchAudio = commandExists("SwitchAudioSource");
  const currentInput = hasSwitchAudio ? getCurrentAudioSource("input") : "(SwitchAudioSource missing)";
  const currentOutput = hasSwitchAudio ? getCurrentAudioSource("output") : "(SwitchAudioSource missing)";

  console.log("Starling cable status");
  console.log(`Current input : ${currentInput}`);
  console.log(`Current output: ${currentOutput}`);

  try {
    const { inputName, outputName } = findVirtualCableName();
    console.log(`${CABLE_DISPLAY_NAME} input : ${inputName}`);
    console.log(`${CABLE_DISPLAY_NAME} output: ${outputName}`);
  } catch (error) {
    console.log(`${CABLE_DISPLAY_NAME} not detected: ${error.message}`);
  }

  if (existsSync(STATE_FILE)) {
    console.log(`Saved state: ${STATE_FILE}`);
  } else {
    console.log("Saved state: none");
  }
}

function uninstall() {
  disconnectForwarding({ quiet: true });
  ensureBrew();

  try {
    run("brew uninstall --cask blackhole-2ch");
    console.log("Uninstalled blackhole-2ch.");
  } catch (error) {
    console.log(`blackhole-2ch uninstall skipped: ${error.message}`);
  }

  try {
    run("brew uninstall switchaudio-osx");
    console.log("Uninstalled switchaudio-osx.");
  } catch (error) {
    console.log(`switchaudio-osx uninstall skipped: ${error.message}`);
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
    connect: () => connect(process.argv[3]),
    disconnect: () => disconnectForwarding(),
    "forward-status": () => forwardStatus(),
    repair,
    uninstall
  };

  if (!actions[command]) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: node scripts/mac-audio.js [install|start|stop|status|connect|disconnect|forward-status|repair|uninstall]");
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