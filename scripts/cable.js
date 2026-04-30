#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BLACKHOLE_NAME = "BlackHole 2ch";
const STATE_DIR = path.join(os.homedir(), ".starling-cable");
const STATE_FILE = path.join(STATE_DIR, "state.json");

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

function findBlackHoleName() {
  const inputs = getAudioSources("input");
  const outputs = getAudioSources("output");

  const inputMatch = inputs.find((n) => n.includes("BlackHole"));
  const outputMatch = outputs.find((n) => n.includes("BlackHole"));

  if (!inputMatch || !outputMatch) {
    const allDevicesJson = run("SwitchAudioSource -a -t all -f json", { quiet: true });
    throw new Error(
      [
        "BlackHole audio devices were not found.",
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
    "xattr -dr com.dropbox.attrs /Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver || true",
    "Starling Cable needs admin access to repair BlackHole audio driver loading."
  );
  runPrivileged(
    "xattr -dr com.apple.provenance /Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver || true",
    "Starling Cable needs admin access to repair BlackHole audio driver loading."
  );
  runPrivileged(
    "killall coreaudiod",
    "Starling Cable needs admin access to reload macOS audio services."
  );

  const devices = findBlackHoleName();
  console.log("Repair complete.");
  console.log(`Detected input: ${devices.inputName}`);
  console.log(`Detected output: ${devices.outputName}`);
}

function ensureVirtualCableReady() {
  ensureDependencies();

  try {
    return findBlackHoleName();
  } catch (firstError) {
    console.log("BlackHole was not detected. Running automatic repair...");
    repair();
    return findBlackHoleName();
  }
}

function install() {
  const devices = ensureVirtualCableReady();
  console.log(`Virtual cable ready with device: ${BLACKHOLE_NAME}`);
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

function stop() {
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
    const { inputName, outputName } = findBlackHoleName();
    console.log(`BlackHole input : ${inputName}`);
    console.log(`BlackHole output: ${outputName}`);
  } catch (error) {
    console.log(`BlackHole not detected: ${error.message}`);
  }

  if (existsSync(STATE_FILE)) {
    console.log(`Saved state: ${STATE_FILE}`);
  } else {
    console.log("Saved state: none");
  }
}

function uninstall() {
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
    repair,
    uninstall
  };

  if (!actions[command]) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: node scripts/cable.js [install|start|stop|status|repair|uninstall]");
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
