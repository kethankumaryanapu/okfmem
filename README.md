# OKFMem Setup

## 1. Clone the repository

git clone <your-github-repository-url>
cd OKFMEM

## 2. Install Node dependencies

npm install
cd backend
npm install
cd ..

## 3. Install Python dependencies

cd backend/memprivacy
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ../..

## 4. Start backend

node backend/server.js

## 5. Open the frontend

Open index.html using VS Code Live Server.
