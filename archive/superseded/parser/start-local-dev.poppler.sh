#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - UNIFIED LOCAL DEVELOPER DEV RUNNER (v1)
# =============================================================================
# This utility automates launching both hot-reloading development servers
# (FastAPI Python Slicer on port 8080 & Next.js Frontend on port 3000)
# simultaneously in a single terminal session with clean SIGINT/Ctrl+C traps.
# =============================================================================

# Pristine Terminal Color Formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}    🚀 FREEFLOW MORTGAGE PORTAL - UNIFIED HOT-RELOAD RUNNER          ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. Self-Correction & Workspace Verification
if [ ! -d "apps/web" ] || [ ! -d "services/doc-parser" ]; then
    echo -e "${RED}❌ Error: This script must be run from your monorepo workspace root directory.${NC}"
    echo -e "Make sure you have run the monorepo migrator script first: ${CYAN}./copy-assets-v19.sh${NC}"
    exit 1
fi

# 2. Check for required local binaries (macOS / Linux)
echo -e "${CYAN}[1/3] Validating system engine binaries...${NC}"
MISSING_DEPS=0

if ! command -v tesseract &> /dev/null; then
    echo -e "${YELLOW}  ⚠ Warning: 'tesseract' binary is not installed locally.${NC}"
    echo -e "    Run: ${CYAN}brew install tesseract${NC} (macOS) or ${CYAN}sudo apt install tesseract-ocr${NC} (Ubuntu)"
    MISSING_DEPS=$((MISSING_DEPS + 1))
else
    echo -e "${GREEN}  ✓ Tesseract OCR verified: $(tesseract --version | head -n 1)${NC}"
fi

if ! command -v pdftoppm &> /dev/null; then
    echo -e "${YELLOW}  ⚠ Warning: 'poppler' utilities (pdftoppm) not found.${NC}"
    echo -e "    Run: ${CYAN}brew install poppler${NC} (macOS) or ${CYAN}sudo apt install poppler-utils${NC} (Ubuntu)"
    MISSING_DEPS=$((MISSING_DEPS + 1))
else
    echo -e "${GREEN}  ✓ Poppler PDF utilities verified.${NC}"
fi

if [ $MISSING_DEPS -gt 0 ]; then
    echo -e "\n${YELLOW}  ⚠️  Continuing startup, but some OCR features may fail bare-metal.${NC}"
    echo -e "  (If you are running everything inside Docker, you can safely ignore this!)\n"
fi

# 3. Graceful shutdown handler (Trapping Ctrl+C)
# This binds exit codes to cleanly kill all spawned background processes
cleanup() {
    echo -e "\n\n${YELLOW}🛑 Shutting down all local development environments...${NC}"
    # Kill background jobs spawned in this subshell process group
    kill $(jobs -p) 2>/dev/null
    echo -e "${GREEN}✓ Dev environments stopped cleanly. Have a great day!${NC}\n"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 4. Starting Python Document Slicer Microservice
echo -e "\n${CYAN}[2/3] Initializing Stateless Python Slicer Microservice (Port 8080)...${NC}"
cd services/doc-parser

# Verify python virtual environment is initialized
if [ -d "venv" ]; then
    echo -e "${GREEN}  ✓ Local virtual environment detected. Activating...${NC}"
    source venv/bin/activate
elif [ -f "requirements.txt" ]; then
    echo -e "${YELLOW}  ⚠ Local python virtualenv not found. Creating 'venv' and syncing requirements...${NC}"
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
fi

# Start FastAPI server in the background, redirect logs to prevent terminal flooding but preserve errors
python3 -m uvicorn src.server:app --host 0.0.0.0 --port 8080 --reload 2>&1 | sed -e 's/^/['"${MAGENTA}"'Python-OCR'"${NC}"'] /' &
PYTHON_PID=$!

# Move back to workspace root
cd ../..

# 5. Starting Next.js Web Application
echo -e "\n${CYAN}[3/3] Initializing Next.js Monorepo Frontend (Port 3000)...${NC}"
cd apps/web

# Check for node_modules presence
if [ ! -d "node_modules" ] && [ ! -d "../../node_modules" ]; then
    echo -e "${YELLOW}  ⚠ Installing workspace Node dependencies first...${NC}"
    pnpm install
fi

# Start Next.js server in the background and pipe logs
pnpm run dev 2>&1 | sed -e 's/^/['"${BLUE}"'Next-Portal'"${NC}"'] /' &
NEXT_PID=$!

cd ../..

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "🥇 ${GREEN}SUCCESS: Local development environments are live and hot-reloading!${NC}"
echo -e "  💻 Next.js Portal Web: ${CYAN}http://localhost:3000${NC}"
echo -e "  ⚡ Python OCR Slicer:  ${CYAN}http://localhost:8080/docs${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo -e "${YELLOW}👉 Press [Ctrl + C] at any time to cleanly shut down both servers.${NC}\n"

# Keep the parent shell session alive to continue piping streams and capturing traps
wait
