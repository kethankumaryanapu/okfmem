const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MEMORIES_FILE = path.resolve(__dirname, 'data', 'memories.json');
const MEMORIES_BACKUP = path.resolve(__dirname, 'data', 'memories.json.task2b_bak');

// Backup original memories.json
if (fs.existsSync(MEMORIES_FILE)) {
  fs.copyFileSync(MEMORIES_FILE, MEMORIES_BACKUP);
}

function restoreData() {
  if (fs.existsSync(MEMORIES_BACKUP)) {
    fs.copyFileSync(MEMORIES_BACKUP, MEMORIES_FILE);
    try { fs.unlinkSync(MEMORIES_BACKUP); } catch (_) {}
  }
}

function request(port, method, reqPath, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: reqPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('=== Task 2B Explainable Memory Retrieval Verification Suite ===\n');
  const port = 5055;
  process.env.PORT = String(port);
  const serverModule = require('./server.js');
  const app = serverModule.app || serverModule;

  const server = app.listen(port);
  let passed = 0;
  let failed = 0;

  try {
    // 1. Check health
    const health = await request(port, 'GET', '/api/health');
    assert(health.status === 200 && health.body.status === 'ok', 'Server health OK');
    console.log('✔ Server health OK');
    passed++;

    // 2. Query with keyword matching a memory (e.g. "React" or "Python")
    console.log('\n[Test 2B.1] Query with relevant memory keyword');
    const chatRes = await request(port, 'POST', '/api/chat', {
      text: "Can you suggest some Python projects for beginners?"
    });

    assert(chatRes.status === 200, 'Chat response status 200');
    assert(chatRes.body.success === true, 'Chat response success true');
    assert(typeof chatRes.body.response === 'string' && chatRes.body.response.length > 0, 'Response text present');
    console.log('✔ Chat response generated successfully');
    console.log('  Provider:', chatRes.body.provider);
    passed++;

    // 3. Verify used_memories array & retrieval_explanation
    console.log('\n[Test 2B.2] Verify retrieval_explanation telemetry in used_memories');
    assert(Array.isArray(chatRes.body.used_memories), 'used_memories is an Array');
    assert(chatRes.body.used_memories.length > 0, 'used_memories contains retrieved memories');

    const firstMem = chatRes.body.used_memories[0];
    console.log('  First used memory:', firstMem.title);
    assert(firstMem.id, 'Memory has id');
    assert(firstMem.title, 'Memory has title');
    assert(firstMem.fact, 'Memory has fact');
    assert(firstMem.category, 'Memory has category');
    assert(firstMem.retrieval_explanation, 'Memory has retrieval_explanation attached');

    const exp = firstMem.retrieval_explanation;
    console.log('  Retrieval Explanation:', JSON.stringify(exp, null, 2));

    assert(typeof exp.score === 'number', 'score is a number');
    assert(typeof exp.rank === 'number' && exp.rank >= 1, 'rank is a positive integer');
    assert(Array.isArray(exp.matched_terms) && exp.matched_terms.length > 0, 'matched_terms is a non-empty array');
    assert(Array.isArray(exp.matched_fields) && exp.matched_fields.length > 0, 'matched_fields is a non-empty array');
    assert(exp.score_breakdown && typeof exp.score_breakdown === 'object', 'score_breakdown is an object');
    assert(typeof exp.score_breakdown.keyword === 'number', 'score_breakdown.keyword is a number');
    assert(typeof exp.score_breakdown.importance === 'number', 'score_breakdown.importance is a number');
    assert(typeof exp.score_breakdown.mention === 'number', 'score_breakdown.mention is a number');
    assert(typeof exp.reason === 'string' && exp.reason.length > 0, 'reason is a non-empty string');

    // Verify mathematical consistency: score == round(keyword + importance + mention, 2)
    const expectedScore = Math.round((exp.score_breakdown.keyword + exp.score_breakdown.importance + exp.score_breakdown.mention) * 100) / 100;
    assert(Math.abs(exp.score - expectedScore) < 0.05, `Score ${exp.score} matches breakdown sum ${expectedScore}`);
    console.log('✔ retrieval_explanation fields and mathematical calculations verified');
    passed++;

    // 4. Verify memories.json persistence protection (Part 3)
    console.log('\n[Test 2B.3] Verify memories.json does NOT contain retrieval_explanation');
    const diskMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const diskHasExplanation = diskMemories.some(m => m.retrieval_explanation !== undefined);
    assert(!diskHasExplanation, 'Disk memories.json has NO retrieval_explanation fields (schema protected)');
    console.log('✔ Disk memories.json schema remains pristine');
    passed++;

    // 5. Verify Unrelated Query returns used_memories = []
    console.log('\n[Test 2B.4] Unrelated Query empty state');
    const unrelatedRes = await request(port, 'POST', '/api/chat', {
      text: "What is the capital of Mars?"
    });
    assert(unrelatedRes.status === 200, 'Unrelated query status 200');
    assert(Array.isArray(unrelatedRes.body.used_memories) && unrelatedRes.body.used_memories.length === 0, 'used_memories is empty for unrelated query');
    console.log('✔ Unrelated query returns empty used_memories without errors');
    passed++;

  } catch (err) {
    console.error('Test execution failure:', err);
    failed++;
  } finally {
    server.close();
    restoreData();
    console.log(`\n=== Task 2B Test Summary: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
  }
}

runTests();
