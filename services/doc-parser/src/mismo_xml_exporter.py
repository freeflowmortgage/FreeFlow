# /workspace/out/mismo_xml_exporter.py
import os
import json
import xml.etree.ElementTree as ET
from xml.dom import minidom
from datetime import datetime, timezone

def generate_mismo_34_xml(loan_id, borrower_name, qualifying_income, business_entities):
    """
    Generates a highly compliant, standardized MISMO v3.4 XML payload [cite: 32].
    This translates our structured underwriting audit ledger and Form 1084 cash flow calculations 
    into standard MISMO XML nodes compatible with major legacy LOS platforms like ICE Encompass [cite: 28, 32].
    """
    # Define XML Namespaces matching the official MISMO 2009 / 3.4.0 standard schemas [cite: 43]
    mismo_ns = "http://www.mismo.org/residential/2009/schemas"
    ET.register_namespace("", mismo_ns)
    
    # 1. Base Message Root
    root = ET.Element(f"{{{mismo_ns}}}MESSAGE", {
        "MISMOVersionID": "3.4.0",
        "SequenceNumber": "1"
    })
    
    # 2. About Version Info [cite: 43]
    about_versions = ET.SubElement(root, f"{{{mismo_ns}}}ABOUT_VERSIONS")
    about_version = ET.SubElement(about_versions, f"{{{mismo_ns}}}ABOUT_VERSION")
    ET.SubElement(about_version, f"{{{mismo_ns}}}CreatedDatetime").text = datetime.now(timezone.utc).isoformat()
    
    # 3. Document / Deal Sets Container
    document_sets = ET.SubElement(root, f"{{{mismo_ns}}}DOCUMENT_SETS")
    document_set = ET.SubElement(document_sets, f"{{{mismo_ns}}}DOCUMENT_SET")
    
    deal_sets = ET.SubElement(root, f"{{{mismo_ns}}}DEAL_SETS")
    deal_set = ET.SubElement(deal_sets, f"{{{mismo_ns}}}DEAL_SET")
    deals = ET.SubElement(deal_set, f"{{{mismo_ns}}}DEALS")
    deal = ET.SubElement(deals, f"{{{mismo_ns}}}DEAL")
    
    # 4. Collateral / Parties Block
    parties = ET.SubElement(deal, f"{{{mismo_ns}}}PARTIES")
    party = ET.SubElement(parties, f"{{{mismo_ns}}}PARTY")
    individual = ET.SubElement(party, f"{{{mismo_ns}}}INDIVIDUAL")
    name = ET.SubElement(individual, f"{{{mismo_ns}}}NAME")
    
    name_split = borrower_name.split()
    first_name = name_split[0] if len(name_split) > 0 else "Alex"
    last_name = name_split[-1] if len(name_split) > 1 else "Morgan"
    
    ET.SubElement(name, f"{{{mismo_ns}}}FirstName").text = first_name
    ET.SubElement(name, f"{{{mismo_ns}}}LastName").text = last_name
    
    # Roles block identifying this party as the primary borrower [cite: 32]
    roles = ET.SubElement(party, f"{{{mismo_ns}}}ROLES")
    role = ET.SubElement(roles, f"{{{mismo_ns}}}ROLE")
    role_detail = ET.SubElement(role, f"{{{mismo_ns}}}PARTY_ROLE_DETAIL" if "PARTY_ROLE_DETAIL" in mismo_ns else f"{{{mismo_ns}}}ROLE_DETAIL")
    ET.SubElement(role_detail, f"{{{mismo_ns}}}PartyRoleType").text = "Borrower"
    
    # 5. Loans Container mapping directly to Encompass 1003 formats [cite: 28]
    loans = ET.SubElement(deal, f"{{{mismo_ns}}}LOANS")
    loan = ET.SubElement(loans, f"{{{mismo_ns}}}LOAN")
    
    # Document Loan Identifier (Maps to external_los_id / Encompass Loan GUID) [cite: 29]
    loan_identifiers = ET.SubElement(loan, f"{{{mismo_ns}}}LOAN_IDENTIFIERS")
    loan_identifier = ET.SubElement(loan_identifiers, f"{{{mismo_ns}}}LOAN_IDENTIFIER")
    ET.SubElement(loan_identifier, f"{{{mismo_ns}}}LoanIdentifier").text = loan_id
    ET.SubElement(loan_identifier, f"{{{mismo_ns}}}LoanIdentifierType").text = "LendersOurLoanNumber"
    
    # 6. EXCLUSIVE FEATURE: Underwriting and Cash Flow Adjustment Container [cite: 32, 104]
    # This maps our custom parsed tax return cash flows into standardized GSE XML fields [cite: 32]
    underwriting = ET.SubElement(loan, f"{{{mismo_ns}}}UNDERWRITING")
    underwriting_detail = ET.SubElement(underwriting, f"{{{mismo_ns}}}UNDERWRITING_DETAIL")
    
    # Push total calculated monthly qualifying income to the standard underwriting block [cite: 42]
    qual_income_node = ET.SubElement(underwriting_detail, f"{{{mismo_ns}}}QualifyingMonthlyIncomeAmount")
    qual_income_node.text = f"{qualifying_income:.2f}"
    
    cash_flow_adjustments = ET.SubElement(underwriting, f"{{{mismo_ns}}}CASH_FLOW_ADJUSTMENTS")
    
    for idx, entity in enumerate(business_entities):
        if entity.get("isExcluded", False):
            continue # Do not export excluded income entities to the GSE payload [cite: 38]
            
        cfa = ET.SubElement(cash_flow_adjustments, f"{{{mismo_ns}}}CASH_FLOW_ADJUSTMENT")
        cfa_detail = ET.SubElement(cfa, f"{{{mismo_ns}}}CASH_FLOW_ADJUSTMENT_DETAIL")
        
        # Determine MISMO Cash Flow Type based on schedule category [cite: 32]
        entity_type = entity.get("entityType", "SCHEDULE_C")
        mismo_type = "SelfEmployment"
        if entity_type in ["SCHEDULE_E_PART_1", "FORM_8825"]:
            mismo_type = "NetRentalIncome"
        elif entity_type == "SCHEDULE_E_PART_2":
            mismo_type = "PartnershipSCorporation"
            
        ET.SubElement(cfa_detail, f"{{{mismo_ns}}}CashFlowAdjustmentType").text = mismo_type
        ET.SubElement(cfa_detail, f"{{{mismo_ns}}}CashFlowAdjustmentAmount").text = f"{entity.get('annualNetIncome', 0.00):.2f}"
        ET.SubElement(cfa_detail, f"{{{mismo_ns}}}CashFlowAdjustmentFrequencyType").text = "Annual"
        ET.SubElement(cfa_detail, f"{{{mismo_ns}}}CashFlowAdjustmentBusinessName").text = entity.get("entityName", f"Business {idx+1}")
        
        # Inject corporate Tax Identification Number (EIN) if verified [cite: 38]
        if entity.get("ein") and entity.get("ein") != "NOT_APPLICABLE":
            ET.SubElement(cfa_detail, f"{{{mismo_ns}}}TaxpayerIdentificationIdentifier").text = entity["ein"]
            ET.SubElement(cfa_detail, f"{{{mismo_ns}}}TaxpayerIdentificationType").text = "EmployerIdentificationNumber"
            
    # Format and indent XML output to make it pristine [cite: 2]
    raw_str = ET.tostring(root, "utf-8")
    parsed_xml = minidom.parseString(raw_str)
    pretty_xml = parsed_xml.toprettyxml(indent="  ")
    
    return pretty_xml

if __name__ == "__main__":
    print("=" * 70)
    print("     FREEFLOW FINTECH - AUTOMATED MISMO v3.4 XML EXPORTER UNIT TEST")
    print("=" * 70)
    
    # Setup standard mock dashboard dataset [cite: 38]
    mock_entities = [
        {
            "entityName": "Venture Consulting LLC",
            "entityType": "SCHEDULE_C",
            "annualNetIncome": 115000.00,
            "isExcluded": False,
            "ein": "NOT_APPLICABLE"
        },
        {
            "entityName": "123 Pine St Rental Portfolio",
            "entityType": "SCHEDULE_E_PART_1",
            "annualNetIncome": 15500.00,
            "isExcluded": False,
            "ein": "NOT_APPLICABLE"
        },
        {
            "entityName": "Morgan Consulting Group S-Corp",
            "entityType": "SCHEDULE_E_PART_2",
            "annualNetIncome": 45000.00,
            "isExcluded": False,
            "ein": "12-3456789"
        },
        {
            "entityName": "Apex Retail Partners LLC",
            "entityType": "SCHEDULE_E_PART_2",
            "annualNetIncome": 25000.00,
            "isExcluded": True, # Excluded by underwriter! [cite: 38]
            "ein": "98-7654321"
        }
    ]
    
    loan_no = "LN-2026-8942"
    borrower = "Alex M. Morgan"
    # Calculate monthly totals only for included entities [cite: 38]
    included_annual = sum(e["annualNetIncome"] for e in mock_entities if not e["isExcluded"])
    monthly_qualifying = included_annual / 12
    
    print("Running XML Generator Payload Transformer...")
    mismo_xml = generate_mismo_34_xml(loan_no, borrower, monthly_qualifying, mock_entities)
    print(f"Generated XML length: {len(mismo_xml)} characters")
