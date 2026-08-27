const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log("=== Task 9 Verification Test ===");

function runPythonChat(inputText) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');

    execFile(pythonPath, [scriptPath, 'chat', inputText], { cwd: __dirname }, (error, stdout, stderr) => {
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

async function runTests() {
  try {
    console.log("\n[Test 1] Testing Memory Extraction on text: 'I am learning Python and I prefer working with FastAPI.'");
    const res1 = await runPythonChat("I am learning Python and I prefer working with FastAPI.");
    console.log("Response success:", res1.success);
    console.log("AI Response:", res1.response);
    console.log("Extracted Memories:", JSON.stringify(res1.extracted_memories, null, 2));

    if (!res1.success || !Array.isArray(res1.extracted_memories) || res1.extracted_memories.length === 0) {
      throw new Error("Test 1 failed: Expected extracted_memories array.");
    }
    console.log("✔ Test 1 PASSED!");

    console.log("\n[Test 2] Testing Privacy Boundary with sensitive data: 'I am learning Python and my email is testuser@domain.com.'");
    const res2 = await runPythonChat("I am learning Python and my email is testuser@domain.com.");
    console.log("Response success:", res2.success);
    console.log("Extracted Memories:", JSON.stringify(res2.extracted_memories, null, 2));

    const emailMem = res2.extracted_memories.find(m => m.fact.includes("testuser@domain.com") || m.title.includes("testuser@domain.com"));
    if (emailMem) {
      console.log("Email Memory Privacy Status:", emailMem.privacy);
      if (emailMem.privacy !== "Protected") {
        throw new Error("Test 2 failed: Expected privacy to be 'Protected' for sensitive items.");
      }
    }
    console.log("✔ Test 2 PASSED!");

    console.log("\n[Test 3] Testing OKF Concept File Generation");
    const { generateOKFConcept } = require('./okf/okfGenerator');
    const sampleMem = {
      id: "M999",
      title: "FastAPI",
      fact: "User prefers working with FastAPI.",
      category: "Preference",
      importance: "High",
      confidence: 94,
      privacy: "Safe",
      source: "Conversation",
      created: "27 Aug 2026"
    };
    const okfResult = generateOKFConcept(sampleMem);
    console.log("Generated OKF relative path:", okfResult.path);
    const fullOkfPath = path.resolve(__dirname, okfResult.path);
    console.log("File exists on disk:", fs.existsSync(fullOkfPath));
    console.log("File content snippet:\n", okfResult.content.substring(0, 150));

    if (!fs.existsSync(fullOkfPath)) {
      throw new Error("Test 3 failed: OKF concept file was not created.");
    }
    console.log("✔ Test 3 PASSED!");

    console.log("\n=== ALL TASK 9 TESTS PASSED SUCCESSFULLY! ===");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    process.exit(1);
  }
}

runTests();
