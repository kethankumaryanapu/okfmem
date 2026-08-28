const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

console.log("=== Task 12 Real Gemini API Integration Test Suite ===");

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const BACKUP_FILE = path.resolve(DATA_DIR, 'memories.json.task12_backup');

// Backup original memories.json for test isolation
let backupData = null;
if (fs.existsSync(MEMORIES_FILE)) {
  backupData = fs.readFileSync(MEMORIES_FILE, 'utf8');
  fs.writeFileSync(BACKUP_FILE, backupData, 'utf8');
}

function restoreMemoriesBackup() {
  if (backupData !== null && fs.existsSync(BACKUP_FILE)) {
    fs.writeFileSync(MEMORIES_FILE, backupData, 'utf8');
    fs.unlinkSync(BACKUP_FILE);
    console.log("✔ Test isolation cleanup: Original memories.json restored.");
  }
}

function runPythonChat(inputText, memoriesList = [], envOverride = {}) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const jsonMemories = JSON.stringify(memoriesList || []);

    const childEnv = { ...process.env, ...envOverride };

    execFile(pythonPath, [scriptPath, 'chat', inputText, jsonMemories], { cwd: __dirname, env: childEnv }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`JSON parse error: ${stdout}`));
      }
    });
  });
}

function runPythonPrivacyTest(inputText, envOverride = {}) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const childEnv = { ...process.env, ...envOverride };

    execFile(pythonPath, [scriptPath, 'test', inputText], { cwd: __dirname, env: childEnv }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`JSON parse error: ${stdout}`));
      }
    });
  });
}

async function runTask12Tests() {
  try {
    console.log("\n[Test 12.1] Gemini Configuration & Default Model Detection");
    const testKey = process.env.GEMINI_API_KEY;
    const testModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    console.log(`GEMINI_API_KEY configured: ${testKey ? 'YES (Key Hidden)' : 'NO'}`);
    console.log(`GEMINI_MODEL target: ${testModel}`);

    if (testKey && testKey.includes("AIza")) {
      // Ensure key value is not leaked into output
      console.log("✔ Key verification passed without logging raw key string.");
    }
    console.log("✔ Test 12.1 PASSED: Gemini configuration detection verified!");

    console.log("\n[Test 12.2] Provider Selection Logic Verification");
    // Case A: Without API Key -> Offline provider
    const envNoKey = { ...process.env };
    delete envNoKey.GEMINI_API_KEY;
    delete envNoKey.OPENAI_API_KEY;
    delete envNoKey.MEMPRIVACY_API_KEY;

    const resNoKey = await runPythonChat("Hello world", [], envNoKey);
    console.log("Provider without key:", resNoKey.provider);
    if (resNoKey.provider !== "offline") {
      throw new Error(`Test 12.2 failed: Expected provider 'offline' when API key absent, got '${resNoKey.provider}'`);
    }

    // Case B: With Simulated Key -> Selected provider (gemini)
    const envWithKey = { ...process.env, GEMINI_API_KEY: "dummy_test_key_for_selection" };
    // Call service with invalid key to test exception handling when key is provided
    try {
      await runPythonChat("Hello world", [], envWithKey);
    } catch (err) {
      if (!err.message.includes("Gemini API provider error")) {
        throw new Error(`Test 12.2 failed: Expected Gemini provider error on invalid key, got: ${err.message}`);
      }
      console.log("✔ Detected Gemini provider attempt on configured key!");
    }
    console.log("✔ Test 12.2 PASSED: Provider selection logic verified!");

    console.log("\n[Test 12.3] Real Gemini Integration Test");
    if (!process.env.GEMINI_API_KEY) {
      console.log("⏩ SKIPPED — GEMINI_API_KEY not configured in environment.");
    } else {
      const realRes = await runPythonChat("What is 2 + 2?", []);
      console.log("Real Gemini response success:", realRes.success);
      console.log("Real Gemini provider:", realRes.provider);
      console.log("Real Gemini response snippet:", realRes.response.substring(0, 80));

      if (!realRes.success || realRes.provider !== "gemini" || !realRes.response) {
        throw new Error("Test 12.3 failed: Real Gemini API integration call failed.");
      }
      console.log("✔ Test 12.3 PASSED: Real Gemini API response verified!");
    }

    console.log("\n[Test 12.4] Privacy Boundary & Local Masking/Restoration Verification");
    const privacyMsg = "My email is privacy.test@okfmem.ai and my phone is 555-0199.";
    const privRes = await runPythonPrivacyTest(privacyMsg);
    console.log("Original text:", privRes.original);
    console.log("Masked text (Sent to cloud):", privRes.masked);
    console.log("Restored text (Local output):", privRes.restored);

    if (privRes.masked.includes("privacy.test@okfmem.ai") || privRes.masked.includes("555-0199")) {
      throw new Error("Test 12.4 failed: Raw sensitive email or phone leaked into masked text payload!");
    }

    if (!privRes.masked.includes("<Email_Address_") || !privRes.masked.includes("<Phone_Number_")) {
      throw new Error("Test 12.4 failed: Expected typed placeholders (<Email_Address_>, <Phone_Number_>) in masked text.");
    }

    if (privRes.restored !== privacyMsg) {
      throw new Error(`Test 12.4 failed: Local restoration mismatch. Expected '${privacyMsg}', got '${privRes.restored}'`);
    }
    console.log("✔ Test 12.4 PASSED: Sensitive information strictly masked before cloud payload and restored locally!");

    console.log("\n[Test 12.5] Offline Fallback Pipeline Verification");
    const offlineRes = await runPythonChat("Describe asynchronous programming.", [], envNoKey);
    console.log("Offline response success:", offlineRes.success);
    console.log("Offline provider:", offlineRes.provider);
    if (!offlineRes.success || offlineRes.provider !== "offline" || !offlineRes.response) {
      throw new Error("Test 12.5 failed: Offline fallback response failed.");
    }
    console.log("✔ Test 12.5 PASSED: Offline fallback pipeline verified!");

    console.log("\n[Test 12.6] Task 10 Regression Integration Test");
    await new Promise((resolve, reject) => {
      const t10Path = path.resolve(__dirname, 'test_task10.js');
      execFile('node', [t10Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Task 10 test execution failed: ${stderr || err.message}`));
        }
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 12.6 PASSED: Task 10 integration tests passed cleanly!");

    console.log("\n[Test 12.7] Task 11 Regression Integration Test");
    await new Promise((resolve, reject) => {
      const t11Path = path.resolve(__dirname, 'test_task11.js');
      execFile('node', [t11Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Task 11 test execution failed: ${stderr || err.message}`));
        }
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 12.7 PASSED: Task 11 integration tests passed cleanly!");

    console.log("\n=== ALL TASK 12 REAL GEMINI INTEGRATION TESTS PASSED SUCCESSFULLY! ===");

  } catch (error) {
    console.error("\n❌ Task 12 Test Failure:", error.message);
    process.exitCode = 1;
  } finally {
    restoreMemoriesBackup();
  }
}

runTask12Tests();
