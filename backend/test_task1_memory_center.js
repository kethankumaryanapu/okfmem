const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.bak');
const OKF_DIR = path.resolve(__dirname, 'okf', 'user-memory', 'memories');
const OKF_INDEX = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
const BACKUP_OKF_INDEX = path.resolve(__dirname, 'okf', 'user-memory', 'index.md.bak');

function backup() {
  if (fs.existsSync(MEMORIES_FILE)) {
    fs.copyFileSync(MEMORIES_FILE, BACKUP_MEMORIES_FILE);
  }
  if (fs.existsSync(OKF_INDEX)) {
    fs.copyFileSync(OKF_INDEX, BACKUP_OKF_INDEX);
  }
}

function restore() {
  if (fs.existsSync(BACKUP_MEMORIES_FILE)) {
    fs.copyFileSync(BACKUP_MEMORIES_FILE, MEMORIES_FILE);
    fs.unlinkSync(BACKUP_MEMORIES_FILE);
  }
  if (fs.existsSync(BACKUP_OKF_INDEX)) {
    fs.copyFileSync(BACKUP_OKF_INDEX, OKF_INDEX);
    fs.unlinkSync(BACKUP_OKF_INDEX);
  }
  ['task1-test-skill', 'task1-renamed-skill', 'rust-performance'].forEach(slug => {
    const f = path.resolve(OKF_DIR, `${slug}.md`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

function startServer(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, () => {
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

async function runTests() {
  console.log('=== Task 1: Memory Center API Automated Test Suite ===\n');
  backup();

  delete require.cache[require.resolve('./server')];
  const { app } = require('./server');
  const { server, port } = await startServer(app);

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
    // 1. GET /api/memories
    console.log('[Test 1] GET /api/memories');
    const resAll = await request(port, 'GET', '/api/memories');
    assert(resAll.status === 200 && Array.isArray(resAll.body.memories), 'Returns list of memories');
    const initialCount = resAll.body.memories.length;
    assert(initialCount > 0, `Initial memory count is ${initialCount}`);

    // 2. GET /api/memories/:id (valid and invalid)
    console.log('\n[Test 2] GET /api/memories/:id');
    const firstMem = resAll.body.memories[0];
    const resOne = await request(port, 'GET', `/api/memories/${firstMem.id}`);
    assert(resOne.status === 200 && resOne.body.success, 'Returns 200 for valid ID');
    assert(resOne.body.memory.id === firstMem.id, `Memory ID matches ${firstMem.id}`);

    const res404 = await request(port, 'GET', '/api/memories/M9999');
    assert(res404.status === 404 && !res404.body.success, 'Returns 404 for invalid ID');

    // 3. POST /api/memories (create memory)
    console.log('\n[Test 3] POST /api/memories');
    const createRes = await request(port, 'POST', '/api/memories', {
      title: 'Task1 Test Skill',
      fact: 'User is mastering memory management architecture.',
      category: 'Skill',
      importance: 'High',
      privacy: 'Protected'
    });
    assert(createRes.status === 201 && createRes.body.success, 'Creates memory with status 201');
    const createdMem = createRes.body.memory;
    assert(createdMem && createdMem.id, `Created memory has ID ${createdMem.id}`);

    const fileAfterCreate = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    assert(fileAfterCreate.some(m => m.id === createdMem.id), 'New memory persists in memories.json');

    const createdOkfFile = path.resolve(OKF_DIR, 'task1-test-skill.md');
    assert(fs.existsSync(createdOkfFile), 'New memory generates OKF markdown file on disk');

    // 4. PUT /api/memories/:id (edit memory)
    console.log('\n[Test 4] PUT /api/memories/:id');
    const updateRes = await request(port, 'PUT', `/api/memories/${createdMem.id}`, {
      title: 'Task1 Renamed Skill',
      fact: 'User has updated this fact successfully.',
      category: 'Preference',
      importance: 'Medium',
      privacy: 'Safe'
    });
    assert(updateRes.status === 200 && updateRes.body.success, 'Updates memory with status 200');
    assert(updateRes.body.memory.title === 'Task1 Renamed Skill', 'Memory title was updated');
    assert(updateRes.body.memory.category === 'Preference', 'Memory category was updated');

    const fileAfterUpdate = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const updatedInFile = fileAfterUpdate.find(m => m.id === createdMem.id);
    assert(updatedInFile.title === 'Task1 Renamed Skill', 'Updated memory persists in memories.json');
    assert(updatedInFile.category === 'Preference', 'Updated category persists in memories.json');

    // Old slug should be deleted, new slug created
    const oldSlugFile = path.resolve(OKF_DIR, 'task1-test-skill.md');
    const newSlugFile = path.resolve(OKF_DIR, 'task1-renamed-skill.md');
    assert(!fs.existsSync(oldSlugFile), 'Old OKF markdown file was deleted after rename');
    assert(fs.existsSync(newSlugFile), 'New OKF markdown file was created with updated slug');

    // 5. Validation on PUT
    console.log('\n[Test 5] Input Validation on PUT');
    const badCatRes = await request(port, 'PUT', `/api/memories/${createdMem.id}`, {
      category: 'InvalidCategory'
    });
    assert(badCatRes.status === 400 && !badCatRes.body.success, 'Rejects invalid category with 400');

    const emptyTitleRes = await request(port, 'PUT', `/api/memories/${createdMem.id}`, {
      title: '   '
    });
    assert(emptyTitleRes.status === 400 && !emptyTitleRes.body.success, 'Rejects empty title with 400');

    // 6. DELETE /api/memories/:id
    console.log('\n[Test 6] DELETE /api/memories/:id');
    const deleteRes = await request(port, 'DELETE', `/api/memories/${createdMem.id}`);
    assert(deleteRes.status === 200 && deleteRes.body.success, 'Deletes memory with status 200');

    const fileAfterDelete = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    assert(!fileAfterDelete.some(m => m.id === createdMem.id), 'Deleted memory removed from memories.json');
    assert(!fs.existsSync(newSlugFile), 'OKF markdown file deleted from disk');

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    server.close();
    restore();
    console.log(`\n=== Task 1 Memory Center Tests Summary: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
  }
}

runTests();
