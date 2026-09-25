const { spawn } = require("child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function startProcess(name, prefix) {
  const child = spawn(npmCommand, ["run", "dev", "--prefix", prefix], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    for (const runningChild of children) {
      if (runningChild.pid && runningChild.pid !== child.pid) {
        runningChild.kill("SIGTERM");
      }
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Failed to start ${name}:`, error);

    for (const runningChild of children) {
      if (runningChild.pid && runningChild.pid !== child.pid) {
        runningChild.kill("SIGTERM");
      }
    }

    process.exit(1);
  });

  children.push(child);
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (child.pid) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startProcess("server", "server");
startProcess("client", "client");
