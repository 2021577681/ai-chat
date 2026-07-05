const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const harnessRoot = path.join(root, 'test-harness');
const port = Number(process.env.E2E_PORT || 4173);
const appUrl = `http://127.0.0.1:${port}/AI-Chat-%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%AF%B9%E8%AF%9D%E5%8A%A9%E6%89%8B.html`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function canReachServer() {
  return new Promise(resolve => {
    const req = http.get(appUrl, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canReachServer()) return true;
    await wait(150);
  }
  return false;
}

async function main() {
  let server = null;
  const alreadyRunning = await canReachServer();
  if (!alreadyRunning) {
    server = spawn(process.execPath, [path.join(root, 'tests', 'e2e', 'static-server.js'), String(port)], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit']
    });
    const ready = await waitForServer();
    if (!ready) {
      if (server) server.kill();
      console.error(`E2E static server did not start on ${appUrl}`);
      process.exit(1);
    }
  }

  const playwrightRoot = fs.existsSync(path.join(harnessRoot, 'node_modules')) ? harnessRoot : root;
  const configPath = fs.existsSync(path.join(harnessRoot, 'playwright.config.js'))
    ? path.join(harnessRoot, 'playwright.config.js')
    : path.join(root, 'playwright.config.js');
  const cli = path.join(playwrightRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const args = [cli, 'test', '--config', configPath, ...process.argv.slice(2)];
  const nodePath = path.join(playwrightRoot, 'node_modules');
  const inheritedNodePath = process.env.NODE_PATH ? `${path.delimiter}${process.env.NODE_PATH}` : '';
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, E2E_PORT: String(port), NODE_PATH: `${nodePath}${inheritedNodePath}` }
  });

  const stopServer = () => {
    if (server && !server.killed) server.kill();
  };
  process.on('SIGINT', () => {
    child.kill('SIGINT');
    stopServer();
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
    stopServer();
  });

  child.on('exit', code => {
    stopServer();
    process.exit(code || 0);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
