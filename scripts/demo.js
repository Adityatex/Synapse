#!/usr/bin/env node
// Public demo helper (production image + Cloudflare quick tunnel).
//   node scripts/demo.js up                 build from this checkout and start
//   node scripts/demo.js up --image <tag>   start a frozen image, no rebuild
//   node scripts/demo.js url                print the current public URL
//   node scripts/demo.js down               stop the demo
const { execSync, spawnSync } = require('child_process');

const COMPOSE = ['compose', '-f', 'docker-compose.demo.yml'];
const [cmd = 'up', ...rest] = process.argv.slice(2);
const imageIdx = rest.indexOf('--image');
const image = imageIdx >= 0 ? rest[imageIdx + 1] : null;

function docker(args, env = process.env) {
  const r = spawnSync('docker', args, { stdio: 'inherit', env, cwd: `${__dirname}/..` });
  if (r.status !== 0) process.exit(r.status || 1);
}

function tunnelUrl() {
  try {
    const logs = execSync(`docker ${COMPOSE.join(' ')} logs tunnel`, { cwd: `${__dirname}/..`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const urls = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    return urls ? urls[urls.length - 1] : null;
  } catch {
    return null;
  }
}

async function waitForUrl() {
  for (let i = 0; i < 60; i++) {
    const url = tunnelUrl();
    if (url) {
      try {
        const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) return url;
      } catch {
        // tunnel not routable yet
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return tunnelUrl();
}

(async () => {
  if (cmd === 'up') {
    if (image) {
      console.log(`Starting frozen image ${image} (no rebuild)…`);
      docker([...COMPOSE, 'up', '-d', '--no-build'], { ...process.env, SYNAPSE_IMAGE: image });
    } else {
      console.log('Building from this checkout and starting…');
      docker([...COMPOSE, 'up', '-d', '--build']);
    }
    const url = await waitForUrl();
    console.log(url ? `\nPublic URL: ${url}\nLocal:      http://localhost:8080\n` : '\nTunnel URL not ready yet; run: npm run demo:url\n');
  } else if (cmd === 'url') {
    const url = tunnelUrl();
    console.log(url || 'No tunnel URL found. Is the demo running? (npm run demo)');
  } else if (cmd === 'down') {
    docker([...COMPOSE, 'down']);
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
})();
