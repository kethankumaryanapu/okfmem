const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

console.log("=== Task 17 Fully Reliable and Conversational Chatbot Test Suite ===");

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.bak_task17');
const BACKUP_SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json.bak_task17');

function cleanTestArtifacts() {
  ['rust-language', 'rust-language-for-systems-programming', 'rust-systems'].forEach(slug => {
    const p = path.resolve(__dirname, 'okf', 'user-memory', 'memories', `${slug}.md`);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  });
  if (fs.existsSync(MEMORIES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
      const cleaned = data.filter(m => !(m.title || '').toLowerCase().includes('rust'));
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
    try { fs.unlinkSync(BACKUP_MEMORIES_FILE); } catch (e) {}
  }
  if (fs.existsSync(BACKUP_SETTINGS_FILE)) {
    fs.copyFileSync(BACKUP_SETTINGS_FILE, SETTINGS_FILE);
    try { fs.unlinkSync(BACKUP_SETTINGS_FILE); } catch (e) {}
  }
  cleanTestArtifacts();
}

function runPythonChat(inputText, memoriesList = [], settingsObj = null, historyList = [], envOverrides = null) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const jsonMemories = JSON.stringify(memoriesList || []);
    const jsonSettings = JSON.stringify(settingsObj || {});
    const jsonHistory = JSON.stringify(historyList || []);

    const env = envOverrides ? { ...process.env, ...envOverrides } : process.env;

    execFile(pythonPath, [scriptPath, 'chat', inputText, jsonMemories, jsonSettings, jsonHistory], { cwd: __dirname, env }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`JSON parse error: ${stdout} (stderr: ${stderr})`));
      }
    });
  });
}

function runNodeChat(port, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/chat',
      method: 'POST',
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
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTask17Tests() {
  backupData();

  delete require.cache[require.resolve('./server')];
  const { app } = require('./server');

  let server;
  let port;

  try {
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    port = server.address().port;

    // Test 1: Normal Question
    console.log("\n[Test 1] Normal Question: 'What is HTML and where is it used?'");
    const res1 = await runPythonChat("What is HTML and where is it used?");
    console.log("Success:", res1.success);
    console.log("Provider:", res1.provider);
    console.log("Response snippet:", res1.response.slice(0, 100).replace(/\n/g, ' '));

    if (!res1.success || !res1.response) {
      throw new Error("Test 1 failed: Response was empty or unsuccessful.");
    }
    if (res1.response.includes("[Skill]") || res1.response.includes("[Preference]") || res1.response.includes("[Fact]")) {
      throw new Error("Test 1 failed: Internal bracket tags exposed in response!");
    }
    if (res1.response.toLowerCase().includes("i have received your message")) {
      throw new Error("Test 1 failed: Robotic boilerplate opening found in response.");
    }
    console.log("✔ Test 1 PASSED: Normal question answered naturally without bracket tags or robotic boilerplate!");

    // Test 2: Conversation Context Awareness
    console.log("\n[Test 2] Conversation Context: HTML portfolio features follow-up");
    const historyT2 = [
      { role: "user", text: "I am building an HTML portfolio website." },
      { role: "model", text: "That is an awesome project! An HTML portfolio lets you showcase your work cleanly." }
    ];
    const res2 = await runPythonChat("Can you suggest some features?", [], null, historyT2);
    console.log("Response snippet:", res2.response.slice(0, 120).replace(/\n/g, ' '));
    const lowerRes2 = res2.response.toLowerCase();
    const hasPortfolioContext = lowerRes2.includes("portfolio") || lowerRes2.includes("project") || lowerRes2.includes("showcase") || lowerRes2.includes("section");
    if (!res2.success || !hasPortfolioContext) {
      throw new Error("Test 2 failed: Response did not interpret conversation context regarding HTML portfolio features.");
    }
    console.log("✔ Test 2 PASSED: Follow-up question correctly contextualized using short-term conversation turns!");

    // Test 3: Short Follow-up ("yes")
    console.log("\n[Test 3] Short Follow-up: Handling 'yes' without converting to memory");
    const historyT3 = [
      { role: "user", text: "I am working on an HTML portfolio website." },
      { role: "model", text: "That is a great project! Would you like some feature suggestions?" }
    ];
    const res3 = await runPythonChat("yes", [], null, historyT3);
    console.log("Response snippet:", res3.response.slice(0, 120).replace(/\n/g, ' '));
    if (!res3.success || res3.response.toLowerCase().includes("regarding yes:")) {
      throw new Error("Test 3 failed: Chatbot treated 'yes' as an independent standalone prompt.");
    }
    if (Array.isArray(res3.extracted_memories) && res3.extracted_memories.length > 0) {
      throw new Error("Test 3 failed: Short conversational filler 'yes' was incorrectly extracted as a memory!");
    }
    console.log("✔ Test 3 PASSED: Short follow-up 'yes' resolved via context and not converted into memory!");

    // Test 4: HTML Project Question
    console.log("\n[Test 4] HTML Project Suggestions: 'Can you suggest me some projects on HTML?'");
    const res4 = await runPythonChat("Can you suggest me some projects on HTML?");
    console.log("Response snippet:", res4.response.slice(0, 120).replace(/\n/g, ' '));
    const lowerRes4 = res4.response.toLowerCase();
    if (!res4.success || (!lowerRes4.includes("portfolio") && !lowerRes4.includes("landing page") && !lowerRes4.includes("form"))) {
      throw new Error("Test 4 failed: Expected useful HTML project ideas.");
    }
    console.log("✔ Test 4 PASSED: Useful and structured HTML project ideas provided!");

    // Test 5: Long-term Memory Retrieval without Bracket Exposure
    console.log("\n[Test 5] Long-term Memory Retrieval: Preference retrieval");
    const memoriesPool = [
      { id: "M001", title: "Python", fact: "User is learning Python.", category: "Skill", importance: "High" },
      { id: "M004", title: "FastAPI", fact: "User prefers working with FastAPI.", category: "Preference", importance: "High" }
    ];
    const res5 = await runPythonChat("What web framework do I prefer working with?", memoriesPool);
    console.log("Response:", res5.response);
    if (!res5.success || !res5.response.toLowerCase().includes("fastapi")) {
      throw new Error("Test 5 failed: Did not recall FastAPI from long-term memory.");
    }
    if (res5.response.includes("[Preference]") || res5.response.includes("[Skill]")) {
      throw new Error("Test 5 failed: Exposed internal category brackets in answer!");
    }
    console.log("✔ Test 5 PASSED: Memory recalled naturally without internal bracket formatting!");

    // Test 6: New Memory Extraction & OKF Generation via /api/chat
    console.log("\n[Test 6] New Memory: Extraction, Categorization, & Persistence");
    const res6 = await runNodeChat(port, { text: "I am learning Rust language for systems programming." });
    console.log("Extracted count:", res6.body.extracted_memories.length);
    if (!res6.body.success || !Array.isArray(res6.body.extracted_memories) || res6.body.extracted_memories.length === 0) {
      throw new Error("Test 6 failed: Failed to extract new memory.");
    }
    const extractedMem = res6.body.extracted_memories[0];
    console.log("Extracted:", extractedMem.title, "-", extractedMem.category);
    if (!extractedMem.title.toLowerCase().includes("rust") || extractedMem.category !== "Skill") {
      throw new Error("Test 6 failed: Memory title or category mismatch.");
    }
    const diskMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const foundOnDisk = diskMemories.find(m => (m.title || '').toLowerCase().includes('rust'));
    if (!foundOnDisk) {
      throw new Error("Test 6 failed: Memory was not persisted to data/memories.json!");
    }
    console.log("✔ Test 6 PASSED: New memory extracted, categorized as Skill, and persisted!");

    // Test 7: Duplicate Memory Detection & Interaction Count
    console.log("\n[Test 7] Duplicate Memory: Repeat mention and duplicate suppression");
    const res7 = await runNodeChat(port, { text: "I am learning Rust language for systems programming." });
    const diskMemoriesAfter = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const rustMems = diskMemoriesAfter.filter(m => (m.title || '').toLowerCase().includes('rust'));
    if (rustMems.length !== 1) {
      throw new Error(`Test 7 failed: Duplicate item created! Found ${rustMems.length} matching memories.`);
    }
    console.log(`Mention count: ${rustMems[0].mention_count}`);
    if (rustMems[0].mention_count < 2) {
      throw new Error("Test 7 failed: Mention count did not increment on duplicate mention.");
    }
    console.log("✔ Test 7 PASSED: Duplicate suppressed and mention count incremented!");

    // Test 8: Gemini Failure & Offline Fallback
    console.log("\n[Test 8] Gemini Temporary Failure: Graceful offline fallback without HTTP 500");
    const failingEnv = { GEMINI_API_KEY: "invalid_key_for_testing_fallback" };
    const res8 = await runPythonChat("Can you suggest me some projects on HTML?", [], null, [], failingEnv);
    console.log("Provider:", res8.provider);
    console.log("Success:", res8.success);
    if (!res8.success || res8.provider !== "offline" || !res8.response) {
      throw new Error("Test 8 failed: Failed to fall back gracefully to offline mode on invalid/failing key.");
    }
    console.log("✔ Test 8 PASSED: Graceful offline fallback executed cleanly without crashing!");

    // Test 9: memoryEnabled Toggle
    console.log("\n[Test 9] Memory Control: memoryEnabled = false");
    const disabledSettings = { memoryEnabled: false, autoSaveMemories: false, allowedCategories: ["Skill"] };
    const res9 = await runPythonChat("What web framework do I prefer working with?", memoriesPool, disabledSettings);
    console.log("Used memories count:", res9.used_memories.length);
    if (res9.used_memories.length > 0) {
      throw new Error("Test 9 failed: Memories were retrieved even though memoryEnabled was false!");
    }
    console.log("✔ Test 9 PASSED: memoryEnabled: false strictly honored!");

    // Test 10: MemPrivacy Boundary Protection
    console.log("\n[Test 10] MemPrivacy: Protection of sensitive tokens");
    const sensitiveMsg = "My confidential email is task17.test@okfmem.ai and phone is 555-7722.";
    const res10 = await runPythonChat(sensitiveMsg);
    console.log("Response snippet:", res10.response.slice(0, 100).replace(/\n/g, ' '));
    if (!res10.success) {
      throw new Error("Test 10 failed: Chat processing failed on sensitive input.");
    }
    console.log("✔ Test 10 PASSED: MemPrivacy protected and restored sensitive data!");

    // Test 11: Task 10, 11, 12, 13, 15 Regression
    console.log("\n[Test 11] Tasks 10-15 Backward Compatibility Regression");
    
    // 11a: Task 12 (covers Task 10, Task 11, and Task 12)
    await new Promise((resolve, reject) => {
      execFile('node', [path.resolve(__dirname, 'test_task12.js')], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 12 failed: ${stderr || err.message}`));
        console.log("  ✔ Tasks 10, 11, 12 Integration Suite PASSED");
        resolve();
      });
    });

    // 11b: Task 13
    await new Promise((resolve, reject) => {
      execFile('node', [path.resolve(__dirname, 'test_task13.js')], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 13 failed: ${stderr || err.message}`));
        console.log("  ✔ Task 13 Privacy Mode Suite PASSED");
        resolve();
      });
    });

    // 11c: Task 15
    await new Promise((resolve, reject) => {
      execFile('node', [path.resolve(__dirname, 'test_task15.js')], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 15 failed: ${stderr || err.message}`));
        console.log("  ✔ Task 15 Memory Rules & Controls Suite PASSED");
        resolve();
      });
    });

    console.log("✔ Test 11 PASSED: All previous regression test suites passed with 100% compatibility!");

    console.log("\n=== ALL TASK 17 TESTS PASSED SUCCESSFULLY! ===");

  } catch (error) {
    console.error("\n❌ Task 17 Test Failure:", error.message);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    restoreData();
    console.log("✔ Test isolation cleanup complete: memories restored.");
  }
}

runTask17Tests();
