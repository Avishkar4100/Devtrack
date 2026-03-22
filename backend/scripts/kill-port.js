const { execSync } = require('child_process');

const port = process.argv[2] || '5000';

const run = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

try {
  if (process.platform === 'win32') {
    const output = run(`netstat -ano | findstr :${port}`);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const pids = new Set();

    lines.forEach((line) => {
      const cols = line.trim().split(/\s+/);
      const pid = cols[cols.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    });

    if (pids.size === 0) {
      console.log(`No process found on port ${port}`);
      process.exit(0);
    }

    for (const pid of pids) {
      try {
        run(`taskkill /PID ${pid} /F`);
        console.log(`Killed PID ${pid} on port ${port}`);
      } catch {
        // Ignore failures for already-terminated or protected processes.
      }
    }
  } else {
    try {
      run(`lsof -ti tcp:${port} | xargs kill -9`);
      console.log(`Killed processes on port ${port}`);
    } catch {
      console.log(`No process found on port ${port}`);
    }
  }
} catch {
  console.log(`No process found on port ${port}`);
}
