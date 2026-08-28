const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { generateOKFConcept } = require('./okf/okfGenerator');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');

const defaultMemories = [
  {
    id: "M001",
    title: "Python",
    fact: "User is learning Python.",
    category: "Skill",
    importance: "High",
    confidence: 96,
    privacy: "Protected",
    source: "Conversation",
    created: "24 Aug 2026"
  },
  {
    id: "M002",
    title: "AI Project",
    fact: "User is working on an AI project.",
    category: "Project",
    importance: "High",
    confidence: 94,
    privacy: "Safe",
    source: "Conversation",
    created: "24 Aug 2026"
  },
  {
    id: "M003",
    title: "Async/Await",
    fact: "User prefers async/await structures.",
    category: "Preference",
    importance: "Medium",
    confidence: 92,
    privacy: "Safe",
    source: "Conversation",
    created: "23 Aug 2026"
  }
];

function loadMemories() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORIES_FILE)) {
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(defaultMemories, null, 2), 'utf8');
      return [...defaultMemories];
    }
    const data = fs.readFileSync(MEMORIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading memories.json:', err);
    return [...defaultMemories];
  }
}

function saveMemories(memList) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memList, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing memories.json:', err);
  }
}

let memories = loadMemories();

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'OKFMem backend is running'
  });
});

app.get('/api/memories', (req, res) => {
  res.json({
    success: true,
    memories: memories
  });
});

app.post('/api/okf/generate', (req, res) => {
  try {
    const memory = req.body;
    if (!memory || !memory.title) {
      return res.status(400).json({ success: false, error: "Invalid memory object" });
    }

    const result = generateOKFConcept(memory);
    res.json({
      success: true,
      message: "OKF concept generated",
      path: result.path
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/okf/memories/:filename', (req, res) => {
  try {
    const rawFilename = req.params.filename;
    const safeFilename = path.basename(rawFilename);
    const memoriesDir = path.resolve(__dirname, 'okf', 'user-memory', 'memories');
    const filePath = path.resolve(memoriesDir, safeFilename);

    if (!filePath.startsWith(memoriesDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'OKF memory document not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/okf/export', (req, res) => {
  try {
    const zip = new AdmZip();
    const targetDir = path.resolve(__dirname, 'okf', 'user-memory');

    if (!fs.existsSync(targetDir)) {
      return res.status(404).json({ success: false, error: 'OKF bundle directory not found' });
    }

    zip.addLocalFolder(targetDir, 'user-memory');
    const buffer = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="okfmem-user-memory.zip"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const { execFile } = require('child_process');

function runMemPrivacyService(text) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');

    execFile(pythonPath, [scriptPath, text], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`MemPrivacy execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Invalid response from MemPrivacy service: ${stdout}`));
      }
    });
  });
}

function runMemPrivacyChat(text, memoriesList = []) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const jsonMemories = JSON.stringify(memoriesList || []);

    execFile(pythonPath, [scriptPath, 'chat', text, jsonMemories], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`MemPrivacy execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Invalid response from MemPrivacy chat service: ${stdout}`));
      }
    });
  });
}

function getFormattedDate() {
  const date = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function updateMemoryInteraction(mem) {
  mem.mention_count = (mem.mention_count || 1) + 1;
  mem.last_seen = getFormattedDate();

  // Task 11 Adaptive Importance Promotion Rules:
  // - Low + mention_count >= 2 -> Medium
  // - Medium + mention_count >= 3 -> High
  // - High remains High
  const currentImp = (mem.importance || 'Medium').trim().toLowerCase();
  if (currentImp === 'low' && mem.mention_count >= 2) {
    mem.importance = 'Medium';
  } else if (currentImp === 'medium' && mem.mention_count >= 3) {
    mem.importance = 'High';
  }

  try {
    generateOKFConcept(mem);
  } catch (okfErr) {
    console.error(`Failed to update OKF concept for memory ${mem.id}:`, okfErr);
  }

  return mem;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { text, message } = req.body || {};
    const inputMessage = text || message;
    if (!inputMessage || typeof inputMessage !== 'string') {
      return res.status(400).json({ success: false, error: 'Message input text is required' });
    }

    const result = await runMemPrivacyChat(inputMessage, memories);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'MemPrivacy processing failed'
      });
    }

    const createdMemories = [];

    if (Array.isArray(result.extracted_memories) && result.extracted_memories.length > 0) {
      for (const cand of result.extracted_memories) {
        const normTitle = (cand.title || '').trim().toLowerCase();
        const normFact = (cand.fact || '').trim().toLowerCase();

        if (!normTitle && !normFact) continue;

        // Check for duplicates in existing memories array
        const existingMem = memories.find(m => {
          const mTitle = (m.title || '').trim().toLowerCase();
          const mFact = (m.fact || '').trim().toLowerCase();
          return (normTitle && mTitle === normTitle) || (normFact && mFact === normFact);
        });

        if (existingMem) {
          // Task 11: Increment mention_count, update last_seen, promote importance if threshold reached
          updateMemoryInteraction(existingMem);
        } else {
          const maxNum = memories.reduce((max, item) => {
            const num = parseInt((item.id || '').replace(/^M0*/, ''), 10);
            return !isNaN(num) && num > max ? num : max;
          }, 0);

          const nextId = `M${String(maxNum + 1).padStart(3, '0')}`;

          const newMem = {
            id: nextId,
            title: cand.title || 'Untitled Memory',
            fact: cand.fact || '',
            category: cand.category || 'Skill',
            importance: cand.importance || 'High',
            confidence: typeof cand.confidence === 'number' ? cand.confidence : 94,
            privacy: cand.privacy || 'Safe',
            source: 'Conversation',
            created: getFormattedDate(),
            mention_count: 1,
            last_seen: getFormattedDate()
          };

          memories.push(newMem);
          createdMemories.push(newMem);

          // Automatically generate OKF Concept document for the extracted memory
          try {
            generateOKFConcept(newMem);
          } catch (okfErr) {
            console.error(`Failed to generate OKF concept for memory ${newMem.id}:`, okfErr);
          }
        }
      }

      saveMemories(memories);
    }

    res.json({
      success: true,
      response: result.response,
      extracted_memories: createdMemories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'An internal error occurred while processing the chat message'
    });
  }
});

app.post('/api/privacy/test', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text input string is required' });
    }

    const result = await runMemPrivacyService(text);
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      original: result.original,
      masked: result.masked,
      restored: result.restored
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`OKFMem backend running at http://localhost:${PORT}`);
});
