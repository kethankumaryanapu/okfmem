# OKFMem — AI Chatbot with Smart Long-Term Memory & MemPrivacy

OKFMem is a privacy-preserving personal memory manager and AI assistant interface supporting the Open Knowledge Format (OKF v0.2) standard.

## Features

- **MemPrivacy Boundary**: On-device privacy detection and typed placeholder replacement (PL2–PL4 taxonomy).
- **Google Gemini API Integration**: Native support for Google Gemini (`gemini-2.5-flash`) with automatic local unmasking.
- **Offline Deterministic Fallback**: Automatic fallback when no API key is provided.
- **Adaptive Memory Importance**: Memory relevance promotion based on mention counts.
- **OKF Concept Synchronization**: Automatic Markdown concept generation and `user-memory/index.md` linking.

## Quickstart & Gemini Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r memprivacy/requirements.txt
npm install
```

### 2. Configure Environment Variables

For Windows PowerShell:

```powershell
$env:GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
$env:GEMINI_MODEL="gemini-2.5-flash"  # Optional, default is gemini-2.5-flash
```

Or copy `.env.example` for reference:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

> **Note**: Do not commit real API keys to repository. `.env` is listed in `.gitignore`.

### 3. Run Backend Server

```bash
cd backend
npm start
```

### 4. Run Integration Tests

```powershell
cd backend
node .\test_task10.js
node .\test_task11.js
node .\test_task12.js
```
