'use strict';

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function readCgroupMemory() {
  // cgroup v2 first, then v1 — inside a container these reflect the limit the
  // container actually runs under, which is what an admin wants to see.
  try {
    const used = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'), 10);
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    const limit = raw === 'max' ? os.totalmem() : parseInt(raw, 10);
    if (Number.isFinite(used) && Number.isFinite(limit)) return { used, total: limit, source: 'cgroup2' };
  } catch { /* not cgroup v2 */ }
  try {
    const used = parseInt(fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8'), 10);
    let limit = parseInt(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8'), 10);
    if (limit > os.totalmem()) limit = os.totalmem();
    if (Number.isFinite(used) && Number.isFinite(limit)) return { used, total: limit, source: 'cgroup1' };
  } catch { /* not cgroup v1 */ }
  return { used: os.totalmem() - os.freemem(), total: os.totalmem(), source: 'host' };
}

async function diskUsage(path = '/') {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', path], { timeout: 3000 });
    const line = stdout.trim().split('\n').pop().split(/\s+/);
    return {
      total: parseInt(line[1], 10) * 1024,
      used: parseInt(line[2], 10) * 1024,
      available: parseInt(line[3], 10) * 1024,
      mount: line[5],
    };
  } catch {
    return null;
  }
}

async function info(sessionManager) {
  const mem = readCgroupMemory();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    uptime: os.uptime(),
    processUptime: process.uptime(),
    loadavg: os.loadavg(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    memory: mem,
    disk: await diskUsage('/'),
    sessions: sessionManager.list().length,
    time: Date.now(),
  };
}

module.exports = { info };
