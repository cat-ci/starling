#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }

    args[part.slice(2)] = argv[index + 1];
    index += 1;
  }

  return args;
}

function buildCaptureSpawn(platform, captureDevice) {
  if (platform === "darwin") {
    return {
      command: "ffmpeg",
      args: [
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-i",
        `:${captureDevice}`,
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1"
      ]
    };
  }

  if (platform === "linux") {
    return {
      command: "ffmpeg",
      args: [
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "pulse",
        "-i",
        captureDevice,
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1"
      ]
    };
  }

  throw new Error(`Unsupported forwarding platform: ${platform}`);
}

function spawnPlayer() {
  return spawn(
    "ffplay",
    [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "error",
      "-fflags",
      "nobuffer",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-i",
      "pipe:0"
    ],
    { stdio: ["pipe", "ignore", "inherit"] }
  );
}

function run() {
  const args = parseArgs(process.argv.slice(3));
  const platform = args.platform;
  const captureDevice = args["capture-device"];
  const peerHost = args["peer-host"];
  const peerPort = Number(args["peer-port"] ?? "4010");
  const listenPort = Number(args["listen-port"] ?? "4010");

  if (!platform || !captureDevice || !peerHost) {
    throw new Error("Missing forwarding arguments.");
  }

  const captureConfig = buildCaptureSpawn(platform, captureDevice);
  const capture = spawn(captureConfig.command, captureConfig.args, {
    stdio: ["ignore", "pipe", "inherit"]
  });

  let outgoingSocket = null;
  let reconnectTimer = null;
  let activeIncomingSocket = null;
  let player = null;
  let shuttingDown = false;

  function stopPlayer() {
    if (player) {
      player.stdin.destroy();
      player.kill("SIGTERM");
      player = null;
    }
  }

  function scheduleReconnect() {
    if (shuttingDown || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToPeer();
    }, 2000);
  }

  function connectToPeer() {
    if (shuttingDown) {
      return;
    }

    const socket = net.createConnection({ host: peerHost, port: peerPort });

    socket.on("connect", () => {
      outgoingSocket = socket;
    });

    socket.on("error", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      if (outgoingSocket === socket) {
        outgoingSocket = null;
      }
      scheduleReconnect();
    });
  }

  capture.stdout.on("data", (chunk) => {
    if (outgoingSocket?.writable) {
      outgoingSocket.write(chunk);
    }
  });

  capture.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`Capture process exited with code ${code ?? "unknown"}.`);
      process.exit(code ?? 1);
    }
  });

  const server = net.createServer((socket) => {
    if (activeIncomingSocket) {
      activeIncomingSocket.destroy();
    }

    stopPlayer();
    activeIncomingSocket = socket;
    player = spawnPlayer();

    socket.on("data", (chunk) => {
      if (player?.stdin.writable) {
        player.stdin.write(chunk);
      }
    });

    const clearIncoming = () => {
      if (activeIncomingSocket === socket) {
        activeIncomingSocket = null;
      }
      stopPlayer();
    };

    socket.on("close", clearIncoming);
    socket.on("error", clearIncoming);
  });

  server.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    outgoingSocket?.destroy();
    activeIncomingSocket?.destroy();
    stopPlayer();
    capture.kill("SIGTERM");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(listenPort, () => {
    connectToPeer();
  });
}

function main() {
  const command = process.argv[2];

  if (command !== "run") {
    console.error("Usage: node scripts/audio-forwarder.js run --platform <darwin|linux> --capture-device <name> --peer-host <ip> [--peer-port 4010] [--listen-port 4010]");
    process.exit(1);
  }

  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();