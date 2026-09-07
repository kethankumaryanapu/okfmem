const fs = require('fs');
const path = require('path');
const http = require('http');
const { app } = require('./server');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.bak');
const BACKUP_SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json.bak');

function cleanTestArtifacts() {
  ['scala', 'rust', 'go', 'flutter-mobile-app'].forEach(slug => {
    const p = path.resolve(__dirname, 'okf', 'user-memory', 'memories', `${slug}.md`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  if (fs.existsSync(MEMORIES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
      const cleaned = data.filter(m => !['scala', 'rust', 'go', 'flutter-mobile-app'].includes((m.title || '').toLowerCase()));
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

async function runTask15Tests() {
  console.log('=== Task 15 User-Controlled Memory & Auto-Save Regression Test Suite ===\n');
  backupData();

  delete require.cache[require.resolve('./server')];
  const { app } = require('./server');

  const port = await new Promise((resolve) => {
    server = app.listen(0, () => {
      resolve(server.address().port);
    });
  });
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
    // 1. GET /api/settings
    console.log('[Test 15.1] GET /api/settings Verification');
    const getSetRes = await request(port, 'GET', '/api/settings');
    assert(getSetRes.status === 200 && getSetRes.body.success, 'GET /api/settings returns 200 OK');
    assert(getSetRes.body.settings && typeof getSetRes.body.settings.memoryEnabled === 'boolean', 'Settings contains memoryEnabled');

    // 2. POST /api/settings
    console.log('\n[Test 15.2] POST /api/settings Verification');
    const postSetRes = await request(port, 'POST', '/api/settings', {
      memoryEnabled: true,
      autoSaveMemories: true,
      allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
      privacyMode: "Protected"
    });
    assert(postSetRes.status === 200 && postSetRes.body.settings.autoSaveMemories === true, 'POST /api/settings updates settings');

    // 3. Auto-Save ON Test (Unique memory creation & OKF generation)
    console.log('\n[Test 15.3] Auto-Save ON Unique Memory Extraction & OKF Generation');
    const initialMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const initialCount = initialMemories.length;

    const chatRes1 = await request(port, 'POST', '/api/chat', { text: "I am currently learning Scala for backend development." });
    assert(chatRes1.status === 200 && chatRes1.body.success, 'Chat request with unique memory succeeds');
    assert(Array.isArray(chatRes1.body.extracted_memories) && chatRes1.body.extracted_memories.length > 0, 'Extracted memory candidate returned');

    const updatedMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    assert(updatedMemories.length === initialCount + 1, `memories.json count increased from ${initialCount} to ${updatedMemories.length}`);

    const scalaOkfFile = path.resolve(__dirname, 'okf', 'user-memory', 'memories', 'scala.md');
    assert(fs.existsSync(scalaOkfFile), 'Corresponding OKF Markdown document generated on disk: scala.md');

    const indexFile = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
    let indexHasScala = false;
    if (fs.existsSync(indexFile)) {
      indexHasScala = fs.readFileSync(indexFile, 'utf8').includes('memories/scala.md');
    }
    assert(indexHasScala, 'OKF index.md contains entry for new memory scala.md');

    // 4. Explainable Memory Retrieval
    console.log('\n[Test 15.4] Explainable Memory Retrieval Verification');
    const chatRes2 = await request(port, 'POST', '/api/chat', { text: "How can I structure my Scala project?" });
    assert(chatRes2.status === 200 && Array.isArray(chatRes2.body.used_memories), 'used_memories array present in chat response');
    const usedScala = (chatRes2.body.used_memories || []).some(m => (m.title || '').toLowerCase().includes('scala'));
    assert(usedScala, 'used_memories includes retrieved Scala memory');

    // 5. Unrelated Query Retrieval Check
    console.log('\n[Test 15.5] Unrelated Query Memory Retrieval Verification');
    const chatRes3 = await request(port, 'POST', '/api/chat', { text: "What is the distance to Jupiter?" });
    assert(chatRes3.status === 200 && Array.isArray(chatRes3.body.used_memories) && chatRes3.body.used_memories.length === 0, 'No memories retrieved for unrelated query');

    // 6. Auto-Save OFF Test
    console.log('\n[Test 15.6] Auto-Save OFF Verification');
    await request(port, 'POST', '/api/settings', { autoSaveMemories: false });
    const countBeforeAutoSaveOff = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;

    const chatRes4 = await request(port, 'POST', '/api/chat', { text: "I am currently learning Go for backend development." });
    assert(chatRes4.status === 200 && chatRes4.body.success, 'Chat request succeeds when Auto-Save is OFF');
    const countAfterAutoSaveOff = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    assert(countAfterAutoSaveOff === countBeforeAutoSaveOff, 'memories.json count remains unchanged when Auto-Save is OFF');

    const goOkfFile = path.resolve(__dirname, 'okf', 'user-memory', 'memories', 'go.md');
    assert(!fs.existsSync(goOkfFile), 'No OKF Markdown document created when Auto-Save is OFF');

    // 7. Memory Enabled OFF Test
    console.log('\n[Test 15.7] Memory Enabled OFF Verification');
    await request(port, 'POST', '/api/settings', { memoryEnabled: false, autoSaveMemories: true });
    const chatRes5 = await request(port, 'POST', '/api/chat', { text: "Tell me about Rust programming" });
    assert(chatRes5.status === 200 && chatRes5.body.success, 'Chat works when Memory Enabled is OFF');
    assert(Array.isArray(chatRes5.body.used_memories) && chatRes5.body.used_memories.length === 0, 'No memories retrieved when Memory Enabled is OFF');

    // 8. Category Filtering Test
    console.log('\n[Test 15.8] Category Filtering Verification');
    await request(port, 'POST', '/api/settings', { memoryEnabled: true, autoSaveMemories: true, allowedCategories: ["Skill"] });
    const countBeforeCat = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;

    const chatRes6 = await request(port, 'POST', '/api/chat', { text: "I am building a Flutter mobile app project." });
    assert(chatRes6.status === 200 && chatRes6.body.success, 'Chat request succeeds');
    const countAfterCat = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8')).length;
    assert(countAfterCat === countBeforeCat, 'Project category memory rejected when only Skill category is allowed');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    restoreData();
    console.log(`\nTask 15 Test Summary: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
  }
}

if (require.main === module) {
  runTask15Tests();
}

module.exports = { runTask15Tests };
