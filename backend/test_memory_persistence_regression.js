const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.bak');
const BACKUP_SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json.bak');

function cleanTestArtifacts() {
  ['elixir', 'haskell', 'clojure'].forEach(slug => {
    const p = path.resolve(__dirname, 'okf', 'user-memory', 'memories', `${slug}.md`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  if (fs.existsSync(MEMORIES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
      const cleaned = data.filter(m => !['elixir', 'haskell', 'clojure'].includes((m.title || '').toLowerCase()));
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
    } catch (e) {}
  }
}

function backupData() {
  cleanTestArtifacts();
  if (fs.existsSync(MEMORIES_FILE)) {
    fs.copyFileSync(MEMORIES_FILE, BACKUP_MEMORIES_FILE);
  }
  if (fs.existsSync(SETTINGS_FILE)) {
    fs.copyFileSync(SETTINGS_FILE, BACKUP_SETTINGS_FILE);
  }
}

function restoreData() {
  if (fs.existsSync(BACKUP_MEMORIES_FILE)) {
    fs.copyFileSync(BACKUP_MEMORIES_FILE, MEMORIES_FILE);
    fs.unlinkSync(BACKUP_MEMORIES_FILE);
  }
  if (fs.existsSync(BACKUP_SETTINGS_FILE)) {
    fs.copyFileSync(BACKUP_SETTINGS_FILE, SETTINGS_FILE);
    fs.unlinkSync(BACKUP_SETTINGS_FILE);
  }
  cleanTestArtifacts();
}

function startServer(appInstance) {
  return new Promise((resolve) => {
    const s = appInstance.listen(0, () => {
      resolve({ server: s, port: s.address().port });
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

async function runRegressionTests() {
  console.log('=== End-to-End Memory Persistence & Count Regression Test Suite ===\n');
  backupData();

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

  // Backup data and clean artifacts first
  backupData();

  // Clear module cache for server so loadMemories() reads clean memories.json
  delete require.cache[require.resolve('./server')];
  let { app } = require('./server');
  let { server, port } = await startServer(app);

  try {
    // ---------------------------------------------------------
    // Test A: Auto-Save ON
    // ---------------------------------------------------------
    console.log('[Test A] Auto-Save ON Unique Memory Persistence & OKF Generation');
    await request(port, 'POST', '/api/settings', {
      memoryEnabled: true,
      autoSaveMemories: true,
      allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
      privacyMode: "Protected"
    });

    const initialMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const initialCount = initialMemories.length;

    const chatResA = await request(port, 'POST', '/api/chat', {
      text: "I am currently learning Elixir for scalable backend services."
    });

    assert(chatResA.status === 200 && chatResA.body.success, 'Chat request succeeds');
    assert(Array.isArray(chatResA.body.extracted_memories) && chatResA.body.extracted_memories.length > 0, 'New memory candidate extracted');

    const updatedMemoriesA = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    assert(updatedMemoriesA.length === initialCount + 1, `memories.json count increased from ${initialCount} to ${updatedMemoriesA.length}`);

    const elixirMem = updatedMemoriesA.find(m => (m.title || '').toLowerCase().includes('elixir'));
    assert(!!elixirMem, 'memories.json contains newly saved Elixir memory');

    const elixirOkfFile = path.resolve(__dirname, 'okf', 'user-memory', 'memories', 'elixir.md');
    assert(fs.existsSync(elixirOkfFile), 'Corresponding OKF Markdown file created on disk');

    const apiMemResA = await request(port, 'GET', '/api/memories');
    assert(apiMemResA.status === 200 && apiMemResA.body.memories.length === updatedMemoriesA.length, 'GET /api/memories returns updated memory count');

    // ---------------------------------------------------------
    // Test B: Auto-Save OFF
    // ---------------------------------------------------------
    console.log('\n[Test B] Auto-Save OFF Persistence Check');
    await request(port, 'POST', '/api/settings', {
      memoryEnabled: true,
      autoSaveMemories: false,
      allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
      privacyMode: "Protected"
    });

    const countBeforeB = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    const chatResB = await request(port, 'POST', '/api/chat', {
      text: "I am currently learning Haskell for functional programming."
    });

    assert(chatResB.status === 200 && chatResB.body.success, 'Chat request succeeds when Auto-Save is OFF');
    const countAfterB = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    assert(countAfterB === countBeforeB, `memories.json count remains unchanged when Auto-Save is OFF (was ${countBeforeB}, now ${countAfterB})`);

    const haskellOkfFile = path.resolve(__dirname, 'okf', 'user-memory', 'memories', 'haskell.md');
    assert(!fs.existsSync(haskellOkfFile), 'OKF document is NOT created when Auto-Save is OFF');

    // ---------------------------------------------------------
    // Test C: Memory Enabled OFF
    // ---------------------------------------------------------
    console.log('\n[Test C] Memory Enabled OFF Check');
    await request(port, 'POST', '/api/settings', {
      memoryEnabled: false,
      autoSaveMemories: true,
      allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
      privacyMode: "Protected"
    });

    const countBeforeC = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    const chatResC = await request(port, 'POST', '/api/chat', {
      text: "I am currently learning Clojure."
    });

    assert(chatResC.status === 200 && chatResC.body.success, 'Chat response succeeds when Memory Enabled is OFF');
    assert(Array.isArray(chatResC.body.used_memories) && chatResC.body.used_memories.length === 0, 'No memories retrieved when Memory Enabled is OFF');
    const countAfterC = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    assert(countAfterC === countBeforeC, 'memories.json count remains unchanged when Memory Enabled is OFF');

    // ---------------------------------------------------------
    // Test D: Duplicate Prevention
    // ---------------------------------------------------------
    console.log('\n[Test D] Duplicate Prevention Check');
    await request(port, 'POST', '/api/settings', { memoryEnabled: true, autoSaveMemories: true });

    const countBeforeD = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    const chatResD = await request(port, 'POST', '/api/chat', {
      text: "I am currently learning Python."
    });

    assert(chatResD.status === 200 && chatResD.body.success, 'Chat request with existing memory statement succeeds');
    const countAfterD = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    assert(countAfterD === countBeforeD, 'Duplicate memory is NOT added as a new record (count remains unchanged)');

    // ---------------------------------------------------------
    // Test E: Restart Persistence
    // ---------------------------------------------------------
    console.log('\n[Test E] Backend Restart Persistence Check');
    server.close();

    // Re-initialize server to simulate backend process restart
    delete require.cache[require.resolve('./server')];
    const serverModule = require('./server');
    const restartObj = await startServer(serverModule.app);
    server = restartObj.server;
    const restartPort = restartObj.port;

    const restartApiRes = await request(restartPort, 'GET', '/api/memories');
    assert(restartApiRes.status === 200 && Array.isArray(restartApiRes.body.memories), 'GET /api/memories succeeds after backend restart');
    const restartMemories = restartApiRes.body.memories;
    const hasElixirAfterRestart = restartMemories.some(m => (m.title || '').toLowerCase().includes('elixir'));
    assert(hasElixirAfterRestart, 'Persisted Elixir memory remains available via /api/memories after restart');
    assert(restartMemories.length === countAfterD, `Memory count (${restartMemories.length}) remains exact after restart`);

  } catch (err) {
    console.error('Regression Test Error:', err);
    failed++;
  } finally {
    server.close();
    restoreData();
    console.log(`\nRegression Test Summary: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
  }
}

if (require.main === module) {
  runRegressionTests();
}

module.exports = { runRegressionTests };
