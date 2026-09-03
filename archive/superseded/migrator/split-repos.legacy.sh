#!/bin/bash

# =====================================================================
#   FREEFLOW INCOME ENGINE - REPOSITORY INITIALIZER & MIGRATION SCRIPT
# =====================================================================
# This script automates the creation of your clean, isolated B2B 
# "AI Income-Only Point Solution" repository. It creates the 
# directory structure, copies your production-ready files into their 
# respective module folders, and initializes a clean Git repository [cite: 38, 66].
#
# Run this from the root directory where your current downloaded files are located.

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}        FREEFLOW INCOME ENGINE: REPOSITORY SPLITTER & GENERATOR       ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Target Repository Name
TARGET_REPO="freeflow-income-engine"

# 1. Check if target directory already exists
if [ -d "$TARGET_REPO" ]; then
    echo -e "${YELLOW}⚠️ WARNING: The directory '$TARGET_REPO' already exists.${NC}"
    read -p "Do you want to overwrite it and recreate the structure? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborting migration.${NC}"
        exit 1
    fi
    echo -e "${YELLOW}Removing existing directory...${NC}"
    rm -rf "$TARGET_REPO"
fi

# 2. Build the decoupled modular folder structure [cite: 38, 66]
echo -e "\n${BLUE}Step 1: Constructing clean architectural folder layers...${NC}"
mkdir -p "$TARGET_REPO/docs"
mkdir -p "$TARGET_REPO/packages/mortgage-engine"
mkdir -p "$TARGET_REPO/packages/ui"
mkdir -p "$TARGET_REPO/apps/web"
mkdir -p "$TARGET_REPO/microservices/python-slicer"
mkdir -p "$TARGET_REPO/nginx"
echo -e "${GREEN}✓ Created repository directory structure.${NC}"

# 3. Locate and migrate your compiled files [cite: 30, 38]
echo -e "\n${BLUE}Step 2: Migrating compiled technical assets into standalone locations...${NC}"

move_file() {
    local src="$1"
    local dest="$2"
    local desc="$3"
    
    if [ -f "$src" ]; then
        cp "$src" "$TARGET_REPO/$dest"
        echo -e "${GREEN}  ✓ Migrated: ${desc} -> $dest${NC}"
    elif [ -f "artifacts/$src" ]; then
        cp "artifacts/$src" "$TARGET_REPO/$dest"
        echo -e "${GREEN}  ✓ Migrated (from artifacts/): ${desc} -> $dest${NC}"
    else
        echo -e "${YELLOW}  ⚠️ Notice: Could not find '$src'. Please ensure to copy it manually to '$dest'.${NC}"
    fi
}

# Python Microservices Layer [cite: 30]
move_file "ai_pdf_converter.py" "microservices/python-slicer/ai_pdf_converter.py" "AI-Ready OCR Sandwich Converter"
move_file "pre_split_tax_returns-v3.py" "microservices/python-slicer/pre_split_tax_returns.py" "Form 1084 Slicing microservice"

# TypeScript Business & Rules Layer [cite: 38]
move_file "calculateForm1084Income.test.js" "packages/mortgage-engine/calculateForm1084Income.test.js" "Form 1084 Mathematical Rules Jest Suite"

# Next.js API Handshake Router [cite: 38]
move_file "underwrite-process-route.ts" "apps/web/underwrite-process-route.ts" "ZDR Next.js API Router Controller"

# Frontend UI Dashboard Layer [cite: 25]
move_file "UnderwriterSplitViewDemo-v2.tsx" "packages/ui/UnderwriterSplitViewDemo.tsx" "Split-Screen Coordinate Highlighting UI"

# Private Nginx Server Shield & Routing [cite: 20]
move_file "nginx-secure-routing.conf" "nginx/secure-routing.conf" "Secure Nginx Loopback Reverse Proxy"

# B2B Audit, Sales & Transition Docs [cite: 20]
move_file "ZDR-Security-Whitepaper.md" "docs/ZDR-Security-Whitepaper.md" "CISO Audit Security Whitepaper"
move_file "Transition-and-Onboarding-Playbook.md" "docs/Transition-and-Onboarding-Playbook.md" "Perpetual Source Handoff Playbook"
move_file "Perpetual-License-Term-Sheet.md" "docs/Perpetual-License-Term-Sheet.md" "Commercial Buyout Term Sheet"

# Create a clean standalone documentation anchor [cite: 38]
if [ -f "deployment-and-architecture-playbook.md" ]; then
    cp "deployment-and-architecture-playbook.md" "$TARGET_REPO/docs/ARCHITECTURE.md"
    echo -e "${GREEN}  ✓ Created Master Technical Documentation -> docs/ARCHITECTURE.md${NC}"
elif [ -f "artifacts/deployment-and-architecture-playbook.md" ]; then
    cp "artifacts/deployment-and-architecture-playbook.md" "$TARGET_REPO/docs/ARCHITECTURE.md"
    echo -e "${GREEN}  ✓ Created Master Technical Documentation -> docs/ARCHITECTURE.md${NC}"
fi

# 4. Generate basic node configuration anchors to bind the project monorepo [cite: 38, 66]
echo -e "\n${BLUE}Step 3: Generating workspace configuration files...${NC}"

cat <<EOF > "$TARGET_REPO/package.json"
{
  "name": "freeflow-income-engine-monorepo",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^1.10.0"
  }
}
EOF

cat <<EOF > "$TARGET_REPO/turborepo.json"
{
  "\$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
EOF

cat <<EOF > "$TARGET_REPO/.gitignore"
# Dependencies
node_modules/
.pnpm-store/

# Builds
.next/
dist/
build/
*.pyc
__pycache__/

# Local Environments & Temp Files
.env
.env.local
.env*.local
*.log
tmp/
freeflow_zdr_*/
EOF

echo -e "${GREEN}✓ Generated root package.json, turborepo.json, and .gitignore files.${NC}"

# 5. Initialize clean standalone Git repository [cite: 38]
echo -e "\n${BLUE}Step 4: Initializing clean, independent Git repository...${NC}"
cd "$TARGET_REPO"
git init -b main
git add .
git commit -m "Initial commit: Decoupled FreeFlow AI Income Ingestion point-solution engine monorepo core assets [cite: 38]"
cd ..

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}  🎉 SUCCESS: स्टैंडअलोन REPOSITIORY SECURELY GENERATED!             ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e " Your new code repository is ready at: ${YELLOW}./$TARGET_REPO${NC}"
echo -e "\n To connect to your new GitHub space and deploy:"
echo -e "   ${BLUE}1. cd $TARGET_REPO${NC}"
echo -e "   ${BLUE}2. git remote add origin <your-new-private-github-url>${NC}"
echo -e "   ${BLUE}3. git push -u origin main${NC}"
echo -e "\n Complete layout instructions are detailed in: ${YELLOW}docs/ARCHITECTURE.md${NC}"
echo -e "${GREEN}======================================================================${NC}"
