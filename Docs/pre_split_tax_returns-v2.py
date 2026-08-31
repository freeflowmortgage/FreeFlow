import os
import re
from pypdf import PdfReader, PdfWriter

def pre_split_tax_returns(input_pdf_path, output_pdf_path):
    """
    Two-Pass Hybrid PDF Splitting Script for FreeFlow Form 1084 Engine.
    Scans a massive tax return PDF (100+ pages), identifies only the pages
    required for comprehensive self-employed underwriting (1040, Schedules B/C/D, 
    K-1s, 1120S, 1065, Form 8825, Form 4562, and supporting Statements), and slices them.
    """
    reader = PdfReader(input_pdf_path)
    writer = PdfWriter()
    total_pages = len(reader.pages)
    
    # Track which pages we need to extract (0-indexed)
    target_pages = set()
    
    # 1. Regex definitions for page identification
    rules = {
        "Form 1040": re.compile(r"U\.S\. Individual Income Tax Return", re.IGNORECASE),
        "Schedule B": re.compile(r"Schedule B.*Interest and Ordinary Dividends", re.IGNORECASE),
        "Schedule C": re.compile(r"Schedule C.*Profit or Loss From Business", re.IGNORECASE),
        "Schedule D": re.compile(r"Schedule D.*Capital Gains and Losses", re.IGNORECASE),
        "Form 1120S": re.compile(r"U\.S\. Income Tax Return for an S Corporation", re.IGNORECASE),
        "Form 1065": re.compile(r"U\.S\. Return of Partnership Income", re.IGNORECASE),
        "Form 1120": re.compile(r"U\.S\. Corporation Income Tax Return", re.IGNORECASE),
        "Schedule K-1": re.compile(r"Schedule K-1", re.IGNORECASE),
        "Form 8825": re.compile(r"Form 8825.*Rental Real Estate Income and Expenses", re.IGNORECASE),
        # CRUCIAL ADDITION: Explicitly match Form 4562 for depreciation/amortization details [cite: 42, 119]
        "Form 4562 (Depreciation & Amortization)": re.compile(r"Form 4562|Depreciation and Amortization", re.IGNORECASE),
        # Capture attachments/supplemental schedules that list itemized breakdowns (amortization/depreciation details)
        "Supporting Statements": re.compile(r"(Statement\s+\d+|Supplemental\s+Statement|Supporting\s+Schedule)", re.IGNORECASE),
        "Amortization Add-Backs": re.compile(r"Amortization\s+deduction|Casualty\s+Loss|Non-recurring\s+other", re.IGNORECASE)
    }

    print(f"--- Initiating First Pass Analysis on: {os.path.basename(input_pdf_path)} ({total_pages} total pages) ---\n")
    
    # First Pass: Search for text patterns page-by-page
    for page_idx in range(total_pages):
        page = reader.pages[page_idx]
        text = page.extract_text()
        
        if not text:
            continue
            
        # Check this page against our extraction rules
        matched_triggers = []
        for rule_name, pattern in rules.items():
            if pattern.search(text):
                matched_triggers.append(rule_name)
                target_pages.add(page_idx)
                
        if matched_triggers:
            print(f"Page {page_idx + 1}: Matched {', '.join(matched_triggers)}")

    # Sort target pages for chronological extraction
    sorted_targets = sorted(list(target_pages))
    
    if not sorted_targets:
        print("Warning: No target tax schedule pages identified. Defaulting to first 4 pages of the return.")
        sorted_targets = list(range(min(4, total_pages)))
        
    print(f"\n--- Initiating Second Pass Targeted Extraction ---")
    print(f"Slicing {len(sorted_targets)} pages out of {total_pages} ({round((len(sorted_targets)/total_pages)*100, 1)}% file volume reduction)...")
    
    # Second Pass: Write out the sliced pages
    for page_idx in sorted_targets:
        writer.add_page(reader.pages[page_idx])
        
    with open(output_pdf_path, "wb") as out_f:
        writer.write(out_f)
        
    print(f"Sanitized file successfully written to: {output_pdf_path}")
    print(f"Targeted file size reduced. Cloud OCR processing fee estimation dropped from ${round(total_pages * 0.50, 2)} to ${round(len(sorted_targets) * 0.50, 2)}!")
    return sorted_targets

if __name__ == "__main__":
    # Test script hooks
    print("Pre-splitting utility initialized successfully with explicit Form 4562 tracking.")
