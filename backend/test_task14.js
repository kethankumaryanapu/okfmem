const fs = require('fs');
const path = require('path');
const http = require('http');
const { app } = require('./server');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.bak');

function backupData() {
  if (fs.existsSync(MEMORIES_FILE)) {
    fs.copyFileSync(MEMORIES_FILE, BACKUP_MEMORIES_FILE);
  }
}

function restoreData() {
  if (fs.existsSync(BACKUP_MEMORIES_FILE)) {
    fs.copyFileSync(BACKUP_MEMORIES_FILE, MEMORIES_FILE);
    fs.unlinkSync(BACKUP_MEMORIES_FILE);
  }
}

let server;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      resolve(server.address().port);
    });
  });
}

function request(port, method, reqPath, data) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: reqPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTask14Tests() {
  console.log('=== Task 14 Persistent Deletion Test Suite ===\n');
  backupData();

  const port = await startServer();
  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`✔ ${msg}`);
      passed++;
    } else {
      console.error(`❌ ${msg}`);
      failed++;
    }
  }

  try {
    // 1. Get initial memories
    console.log('[Test 14.1] Fetch Initial Memories');
    const getRes1 = await request(port, 'GET', '/api/memories');
    assert(getRes1.status === 200 && Array.isArray(getRes1.body.memories), 'GET /api/memories returns memories list');
    const targetMemory = getRes1.body.memories[0];
    assert(targetMemory && targetMemory.id, 'Target memory for deletion exists');

    if (targetMemory) {
      const targetId = targetMemory.id;
      const slug = (targetMemory.title || "memory").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'memory';
      const conceptFile = path.resolve(__dirname, 'okf', 'user-memory', 'memories', `${slug}.md`);

      // 2. Perform DELETE request
      console.log(`\n[Test 14.2] DELETE /api/memories/${targetId}`);
      const delRes = await request(port, 'DELETE', `/api/memories/${targetId}`);
      assert(delRes.status === 200 && delRes.body.success, 'DELETE request returned success 200');

      // 3. Check memories.json on disk
      const fileData = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
      const foundInDisk = fileData.some(m => m.id === targetId);
      assert(!foundInDisk, 'Memory successfully removed from memories.json on disk');

      // 4. Check OKF Concept file deletion
      const conceptExists = fs.existsSync(conceptFile);
      assert(!conceptExists, `OKF Concept Markdown file deleted from disk: ${slug}.md`);

      // 5. Check OKF Index cleanup
      const indexPath = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
      let indexCleaned = true;
      if (fs.existsSync(indexPath)) {
        const indexText = fs.readFileSync(indexPath, 'utf8');
        indexCleaned = !indexText.includes(`memories/${slug}.md`);
      }
      assert(indexCleaned, 'OKF index.md link removed for deleted memory');
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    restoreData();
    console.log(`\nTask 14 Test Summary: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
  }
}

if (require.main === module) {
  runTask14Tests();
}

module.exports = { runTask14Tests };
