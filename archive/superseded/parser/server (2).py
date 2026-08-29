import os
import shutil
import uuid
import base64
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.responses import JSONResponse
from pypdf import PdfReader, PdfWriter
import uvicorn

# Import our custom processors
from ai_pdf_converter import AIPDFConverter
from pre_split_tax_returns_v4 import pre_split_tax_returns

app = FastAPI(
    title="FreeFlow Stateless Slicing Engine API",
    description="Stateless PDF Slicing & Computer Vision Sandwich OCR Pre-processing Microservice [cite: 31, 33]",
    version="4.0.0"
)

@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "HEALTHY", "service": "FreeFlow Document Processing Engine"}

@app.post("/api/underwrite/process", status_code=status.HTTP_200_OK)
async def process_document(file: UploadFile = File(...)):
    """
    Stateless endpoint that accepts an uploaded PDF file, enhances it,
    slices Schedule C/E target pages, and purges all binary remains from memory immediately [cite: 30, 31, 33].
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only PDF files are authorized for ingestion."
        )

    # Generate isolated, ephemeral transaction subdirectory inside secure system tmp space [cite: 31, 33]
    transaction_id = str(uuid.uuid4())
    temp_dir = f"/tmp/freeflow_zdr_{transaction_id}"
    os.makedirs(temp_dir, exist_ok=True)

    input_path = f"{temp_dir}/raw_upload.pdf"
    searchable_path = f"{temp_dir}/searchable_overlay.pdf"
    sliced_path = f"{temp_dir}/sliced_schedules.pdf"

    try:
        # Step 1: Buffer raw stream directly to ephemeral container storage
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Step 2: Initialize OCR-Sandwich Computer Vision Converter [cite: 30]
        converter = AIPDFConverter()
        is_searchable = converter.is_searchable(input_path)
        
        source_for_extraction = input_path
        was_sandwich_applied = False

        if not is_searchable:
            # Apply transparent text overlay & image sharpening if flat scanned file
            converter.convert_to_ai_ready(input_path, searchable_path)
            source_for_extraction = searchable_path
            was_sandwich_applied = True

        # Step 3: Execute Four-Pass Optimized PDF Slicing Engine [cite: 30, 38]
        # Slices out core Schedule C/E and corresponding supporting statements
        target_pages = pre_split_tax_returns(source_for_extraction, sliced_path)
        
        has_business_returns = len(target_pages) > 0 and any(idx > 0 for idx in target_pages)
        
        # Step 4: Base64 encode the sliced PDF payload to return via JSON handshake [cite: 30, 31]
        sliced_pdf_base64 = ""
        if os.path.exists(sliced_path):
            with open(sliced_path, "rb") as f:
                sliced_pdf_base64 = base64.b64encode(f.read()).decode("utf-8")

        # Compile metadata response [cite: 30, 33]
        response_payload = {
            "transaction_id": transaction_id,
            "original_filename": file.filename,
            "was_sandwich_applied": was_sandwich_applied,
            "total_pages_scanned": len(PdfReader(input_path).pages),
            "pages_extracted_count": len(target_pages),
            "extracted_page_indices": target_pages,
            "has_business_returns": has_business_returns,
            "sliced_pdf_payload_b64": sliced_pdf_base64
        }

        return JSONResponse(content=response_payload)

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Document processing failed during in-memory slicing execution: {str(e)}"
        )

    finally:
        # Zero-Data-Retention (ZDR) Enforcement Gate: Strictly purge files from local tmp disk [cite: 33]
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"[ZDR Purge] Epstein-safe transaction directory {temp_dir} completely wiped.")

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8080)
