const fs = require('fs');
const path = require('path');

/**
 * Generates an OKF v0.2 concept Markdown document from a memory record.
 * @param {Object} memory - Memory object ({ id, title, fact, category, source, created })
 * @returns {Object} { path: string, content: string }
 */
function generateOKFConcept(memory) {
  const title = memory.title || "Untitled Memory";
  const fact = memory.fact || "";
  const category = memory.category || "General";

  // Producer-defined concept type (OKF v0.2 compliant)
  const conceptType = `User ${category}`;

  // Slugify title for filename
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'memory';

  // Generate tags
  const tags = [
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category.toLowerCase()
  ].filter(Boolean);

  // Construct OKF v0.2 Markdown document with YAML frontmatter
  const content = `---
type: ${conceptType}
title: ${title}
description: ${fact}
tags:
${tags.map(t => `  - ${t}`).join('\n')}
---

# ${title}

${fact}
`;

  // Ensure target directory exists: backend/okf/user-memory/memories/
  const memoriesDir = path.join(__dirname, 'user-memory', 'memories');
  if (!fs.existsSync(memoriesDir)) {
    fs.mkdirSync(memoriesDir, { recursive: true });
  }

  const filePath = path.join(memoriesDir, `${slug}.md`);
  fs.writeFileSync(filePath, content, 'utf8');

  // Relative path from backend directory
  const relativePath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');

  return {
    path: relativePath,
    content: content
  };
}

module.exports = {
  generateOKFConcept
};
