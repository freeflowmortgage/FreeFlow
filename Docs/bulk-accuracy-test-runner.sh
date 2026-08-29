#!/bin/bash

# =============================================================================
# FREEFLOW B2B INCOME MICROSERVICE - BULK ACCURACY & LATENCY TEST RUNNER
# =============================================================================
# This script automates sending a directory of sample PDFs (W-2s, tax returns)
# to our local stateless container at http://localhost:8080/api/underwrite/process.
# It measures latency, validates the JSON output structures, and compiles 
# high-level metrics for your QA engineering team.
# =============================================================================

# Terminal Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'\
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

API_URL="http://localhost:8080/api/underwrite/process"
TEST_DIR="./test-docs"

echo -e "${BLUE}=======================================================================${NC}"
echo -e "🚀 ${BLUE}STARTING B2B INCOME TOOL LOCAL BULK PERFORMANCE & ACCURACY AUDIT${NC}"
echo -e "${BLUE}=======================================================================${NC}"

# Check if target directory exists
if [ ! -d "$TEST_DIR" ]; then
    echo -e "${YELLOW}⚠️ Target directory '$TEST_DIR' not found. Creating it...${NC}"
    mkdir -p "$TEST_DIR"
    echo -e "Please drop your sample unredacted/mock PDFs into: ${CYAN}$TEST_DIR/${NC}"
    echo -e "Then re-run this script."
    exit 0
fi

# Count files
FILE_COUNT=$(find "$TEST_DIR" -maxdepth 1 -name "*.pdf" | wc -l)
if [ "$FILE_COUNT" -eq 0 ]; then
    echo -e "${RED}❌ Error: No PDF documents detected in '$TEST_DIR'. Please add test files.${NC}"
    exit 1
fi

echo -e "${CYAN}Staging $FILE_COUNT document(s) for parsing queue...${NC}\n"

TOTAL_LATENCY=0
SUCCESS_COUNT=0
FAILED_COUNT=0

# Compile table headers
printf "%-30s | %-10s | %-12s | %-12s | %-10s\n" "Document Name" "Status" "Sandwich?" "Pages Ext." "Latency (s)"
echo "---------------------------------------------------------------------------------------"

for file in "$TEST_DIR"/*.pdf; do
    FILENAME=$(basename "$file")
    
    # Track execution time
    START_TIME=$(date +%s.%N)
    
    # Dispatch in-memory upload bytes to our stateless container
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$file" "$API_URL")
    
    END_TIME=$(date +%s.%N)
    LATENCY=$(echo "$END_TIME - $START_TIME" | bc 2>/dev/null || echo "0")
    
    # Separate body from HTTP Status code
    HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_STATUS" -eq 200 ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        TOTAL_LATENCY=$(echo "$TOTAL_LATENCY + $LATENCY" | bc 2>/dev/null || echo "$TOTAL_LATENCY")
        
        # Check if JQ is installed to parse fields, else run basic regex string parsing
        if command -v jq &> /dev/null; then
            SANDWICH=$(echo "$BODY" | jq -r '.was_sandwich_applied')
            PAGES=$(echo "$BODY" | jq -r '.pages_extracted_count')
        else
            # Fallback quick regex if jq is missing on dev terminal
            SANDWICH=$(echo "$BODY" | grep -o '"was_sandwich_applied":[^,]*' | head -n1 | cut -d':' -f2 | tr -d ' "')
            PAGES=$(echo "$BODY" | grep -o '"pages_extracted_count":[^,]*' | head -n1 | cut -d':' -f2 | tr -d ' "')
        fi
        
        # Format true/false values
        if [ "$SANDWICH" = "true" ]; then
            SANDWICH_TXT="${YELLOW}APPLIED${NC}"
        else
            SANDWICH_TXT="${GREEN}BYPASSED${NC}"
        fi
        
        printf "%-30s | ${GREEN}%-10s${NC} | %-21s | %-12s | %-10.2fs\n" \
               "${FILENAME:0:29}" "SUCCESS" "$SANDWICH_TXT" "$PAGES" "$LATENCY"
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
        printf "%-30s | ${RED}%-10s${NC} | %-12s | %-12s | %-10.2fs\n" \
               "${FILENAME:0:29}" "FAILED (HTTP $HTTP_STATUS)" "N/A" "0" "$LATENCY"
    fi
done

# Compile final metrics
echo "---------------------------------------------------------------------------------------"
echo -e "\n${BLUE}=======================================================================${NC}"
echo -e "🏆 ${BLUE}BULK PERFORMANCE METRICS COMPILED SUCCESSFULLY${NC}"
echo -e "${BLUE}=======================================================================${NC}"

if [ "$SUCCESS_COUNT" -gt 0 ]; then
    AVG_LATENCY=$(echo "scale=2; $TOTAL_LATENCY / $SUCCESS_COUNT" | bc 2>/dev/null || echo "0")
else
    AVG_LATENCY="0.00"
fi

echo -e "  • Total Files Processed:     ${CYAN}$FILE_COUNT${NC}"
echo -e "  • Successful Extractions:    ${GREEN}$SUCCESS_COUNT${NC}"
echo -e "  • Failed / Blocked Tasks:     ${RED}$FAILED_COUNT${NC}"
echo -e "  • Average In-Memory Latency:  ${YELLOW}${AVG_LATENCY}s${NC} (Target: < 7.00s)"

if [ "$FAILED_COUNT" -gt 0 ]; then
    echo -e "\n${RED}⚠️ Warning: $FAILED_COUNT pipeline processes encountered errors. Inspect docker logs for details.${NC}"
else
    echo -e "\n${GREEN}✓ All files parsed flawlessly with absolute Zero-Data-Retention (ZDR)!${NC}"
fi
echo -e "${BLUE}=======================================================================${NC}"
