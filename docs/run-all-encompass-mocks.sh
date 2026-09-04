#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - ENCOMPASS INTEGRATION MOCK TEST RUNNER (v1)
# =============================================================================
# This utility automates executing both Jest integration testing suites
# side-by-side to verify the mapping layers and eFolder attachment payloads.
#   - Income Ingestion Sync (Standard Fields & Schedule L Column d)
#   - Appraisal Audit Sync (VA NOV conditions & Spatial PDF coordinate markers)
# =============================================================================

# Terminal Color Formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}    🛰️  FREEFLOW ENCOMPASS INTEGRATION MOCK TEST RUNNER                ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Check for monorepo package configuration
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: This script must be run from your monorepo workspace root directory.${NC}"
    exit 1
fi

echo -e "${CYAN}[1/2] Initiating Autonomous Income Engine Sync Verification...${NC}"
echo -e "      Testing standard field mappings (110, 111, 108) and corporate balance sheet liquidity."

pnpm --filter @mortgage-pos/mortgage-engine test tests/map-encompass-fields.test.ts 2>&1 | sed -e 's/^/['"${CYAN}"'Income-Test'"${NC}"'] /'
INCOME_EXIT_CODE=${PIPESTATUS[0]}

echo -e "\n${CYAN}[2/2] Initiating Autonomous Appraisal Review Sync Verification...${NC}"
echo -e "      Testing FHA/VA Case Number matching, spatial highlights, and pre-filled NOV conditions."

pnpm --filter @mortgage-pos/appraisal-engine test tests/appraisal-sync.test.ts 2>&1 | sed -e 's/^/['"${BLUE}"'Appraisal-Test'"${NC}"'] /'
APPRAISAL_EXIT_CODE=${PIPESTATUS[0]}

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "${BLUE}    📊 INTEGRATION TEST MATRIX RECONCILIATION SUMMARY                ${NC}"
echo -e "${BLUE}======================================================================${NC}"

if [ $INCOME_EXIT_CODE -eq 0 ]; then
    echo -e "  - Income Field & Schedule L Map Test:  ${GREEN}PASS (100% Target Match)${NC}"
else
    echo -e "  - Income Field & Schedule L Map Test:  ${RED}FAIL (Verify map-encompass-fields.ts)${NC}"
fi

if [ $APPRAISAL_EXIT_CODE -eq 0 ]; then
    echo -e "  - Appraisal spatial & NOV Condition Test: ${GREEN}PASS (100% Target Match)${NC}"
else
    echo -e "  - Appraisal spatial & NOV Condition Test: ${RED}FAIL (Verify AppraisalRulesEngine.ts)${NC}"
fi
echo -e "${BLUE}======================================================================${NC}\n"

# Aggregate exit status
if [ $INCOME_EXIT_CODE -eq 0 ] && [ $APPRAISAL_EXIT_CODE -eq 0 ]; then
    echo -e "🏆 ${GREEN}INTEGRATION TESTS PASSED CLEANLY under SOC 2 cryptographic boundaries.${NC}\n"
    exit 0
else
    echo -e "❌ ${RED}INTEGRATION TESTING DETECTED ADAPTER ERRORS. Repair files listed above.${NC}\n"
    exit 1
fi
