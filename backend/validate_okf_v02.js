const path = require('path');
const fs = require('fs');
const http = require('http');
const AdmZip = require('adm-zip');

console.log("==================================================");
console.log("       OKF v0.2 OFFICIAL SPECIFICATION VALIDATOR  ");
console.log("==================================================\n");

const BACKEND_DIR = path.resolve(__dirname);
const USER_MEMORY_DIR = path.resolve(__dirname, 'okf', 'user-memory');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`VALIDATION FAILURE: ${message}`);
  }
}

// 1. Validate Conformance against OKF v0.2 (§11 Conformance)
function validateBundleStructure() {
  console.log("[Phase 1] Inspecting Knowledge Bundle File Tree & Conformance (§11)...");

  assert(fs.existsSync(USER_MEMORY_DIR), "user-memory directory exists");

  const rootIndex = path.join(USER_MEMORY_DIR, 'index.md');
  assert(fs.existsSync(rootIndex), "Root index.md exists (§8)");
  const rootIndexContent = fs.readFileSync(rootIndex, 'utf8');
  assert(rootIndexContent.startsWith('---\nokf_version: "0.2"\n---'), "Root index.md declares okf_version: '0.2' (§12)");
  assert(rootIndexContent.includes('# User Memory Bundle'), "Root index.md contains standard bundle heading");

  const rootLog = path.join(USER_MEMORY_DIR, 'log.md');
  assert(fs.existsSync(rootLog), "Root log.md exists (§9)");
  const rootLogContent = fs.readFileSync(rootLog, 'utf8');
  assert(rootLogContent.includes('# Memory Bundle Update Log'), "log.md contains update log heading (§9)");
  assert(/## \d{4}-\d{2}-\d{2}/.test(rootLogContent), "log.md contains ISO 8601 date headings YYYY-MM-DD (§9)");

  const expectedDirs = ['skills', 'preferences', 'projects', 'facts'];
  for (const dirName of expectedDirs) {
    const dirPath = path.join(USER_MEMORY_DIR, dirName);
    assert(fs.existsSync(dirPath), `Category directory '${dirName}' exists`);

    const subIndex = path.join(dirPath, 'index.md');
    assert(fs.existsSync(subIndex), `Subdirectory index '${dirName}/index.md' exists (§8)`);
    const subIndexContent = fs.readFileSync(subIndex, 'utf8');
    assert(!subIndexContent.startsWith('---'), `Subdirectory index '${dirName}/index.md' MUST NOT contain frontmatter (§8)`);
    assert(subIndexContent.includes(`# `), `Subdirectory index '${dirName}/index.md' has heading`);
  }

  // Walk all markdown files in category folders and validate frontmatter & body (§4)
  let conceptCount = 0;
  for (const dirName of expectedDirs) {
    const dirPath = path.join(USER_MEMORY_DIR, dirName);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md');

    for (const f of files) {
      conceptCount++;
      const fullPath = path.join(dirPath, f);
      const content = fs.readFileSync(fullPath, 'utf8');

      // 1. YAML frontmatter delimited by ---
      assert(content.startsWith('---\n'), `${dirName}/${f} starts with YAML frontmatter delimiter '---'`);
      const endFm = content.indexOf('\n---\n', 4);
      assert(endFm !== -1, `${dirName}/${f} has closing YAML frontmatter delimiter '---'`);

      const fm = content.substring(4, endFm);
      const body = content.substring(endFm + 5);

      // 2. REQUIRED field: type
      assert(/^type:\s*.+$/m.test(fm), `${dirName}/${f} contains REQUIRED 'type' field (§4.1)`);

      // 3. Recommended fields
      assert(/^title:\s*.+$/m.test(fm), `${dirName}/${f} contains recommended 'title' field (§4.1)`);
      assert(/^description:\s*.+$/m.test(fm), `${dirName}/${f} contains recommended 'description' field (§4.1)`);

      // 4. v0.2 Provenance & Actor fields (§5.2 & §7)
      assert(/^generated:/m.test(fm), `${dirName}/${f} contains 'generated' provenance object (§5.2)`);
      assert(/by:\s*[a-z0-9_:\/-]+/i.test(fm), `${dirName}/${f} contains valid actor string in generated.by (§7)`);
      assert(/at:\s*\d{4}-\d{2}-\d{2}T/i.test(fm), `${dirName}/${f} contains ISO 8601 datetime in generated.at (§5.2)`);
      assert(/^status:\s*stable/m.test(fm), `${dirName}/${f} contains lifecycle status (§5.4)`);

      // 5. Body structure
      assert(body.includes('# '), `${dirName}/${f} body contains top-level markdown heading (# Title)`);

      // 6. Cross-concept links validation (§6)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(body)) !== null) {
        const linkUrl = match[2];
        if (linkUrl.endsWith('.md')) {
          const resolvedLink = path.resolve(dirPath, linkUrl);
          assert(fs.existsSync(resolvedLink), `Cross-concept link '${linkUrl}' in ${dirName}/${f} points to an existing file: ${resolvedLink}`);
        }
      }
    }
  }

  console.log(`✔ Conformance PASSED: Validated ${conceptCount} concept documents, 5 indexes, and log.md according to OKF v0.2!`);
}

// 2. Validate API endpoints
async function validateEndpoints(port) {
  console.log("\n[Phase 2] Validating Backend OKF API Endpoints...");

  function getJson(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }).on('error', reject);
    });
  }

  function getBuffer(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) });
        });
      }).on('error', reject);
    });
  }

  // 1. GET /api/okf/tree
  const treeRes = await getJson('/api/okf/tree');
  assert(treeRes.status === 200, "GET /api/okf/tree returns 200");
  assert(treeRes.body.success === true, "GET /api/okf/tree returns success: true");
  assert(treeRes.body.bundle.specVersion === "0.2", "Bundle spec version is '0.2'");
  assert(Array.isArray(treeRes.body.bundle.categories), "Bundle categories array present");
  console.log("✔ GET /api/okf/tree verified successfully!");

  // 2. GET /api/okf/file?path=skills/python.md
  const fileRes = await getJson('/api/okf/file?path=skills/python.md');
  assert(fileRes.status === 200, "GET /api/okf/file returns 200 for skills/python.md");
  assert(fileRes.body.success === true, "File query returns success: true");
  assert(fileRes.body.type === "User Skill", "Parsed type is 'User Skill'");
  assert(fileRes.body.frontmatter && fileRes.body.frontmatter.title === "Python", "Frontmatter parsed title 'Python'");
  console.log("✔ GET /api/okf/file verified successfully!");

  // 3. Security: Directory Traversal Defense
  const traversalRes = await getJson('/api/okf/file?path=../../package.json');
  assert(traversalRes.status === 404, "Directory traversal attempt properly rejected with 404");
  console.log("✔ Path traversal protection verified!");

  // 4. GET /api/okf/export
  const exportRes = await getBuffer('/api/okf/export');
  assert(exportRes.status === 200, "GET /api/okf/export returns 200");
  assert(exportRes.headers['content-type'] === 'application/zip', "Export header is application/zip");

  const zip = new AdmZip(exportRes.buffer);
  const zipEntries = zip.getEntries().map(e => e.entryName);

  assert(zipEntries.some(e => e.includes('index.md')), "Zip export contains root index.md");
  assert(zipEntries.some(e => e.includes('log.md')), "Zip export contains log.md");
  assert(zipEntries.some(e => e.includes('skills/python.md')), "Zip export contains skills/python.md");
  assert(!zipEntries.some(e => e.endsWith('memories.json')), "Zip export MUST NOT contain memories.json (no JSON pretending to be OKF)");
  console.log("✔ GET /api/okf/export verified: Zip contains genuine OKF v0.2 bundle tree!");
}

async function runAll() {
  try {
    // Phase 1: Static Conformance
    validateBundleStructure();

    // Spin up server on test port for Phase 2
    const { app } = require('./server');
    const TEST_PORT = 5098;
    const server = app.listen(TEST_PORT, async () => {
      try {
        await validateEndpoints(TEST_PORT);
        server.close(() => {
          console.log("\n==================================================");
          console.log("   ALL OKF v0.2 SPECIFICATION TESTS PASSED!       ");
          console.log("==================================================");
          process.exit(0);
        });
      } catch (testErr) {
        server.close();
        console.error("\n❌ VALIDATION ERROR:", testErr.message);
        process.exit(1);
      }
    });
  } catch (err) {
    console.error("\n❌ VALIDATION ERROR:", err.message);
    process.exit(1);
  }
}

runAll();
