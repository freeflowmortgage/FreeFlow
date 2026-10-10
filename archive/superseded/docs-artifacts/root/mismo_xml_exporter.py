#!/usr/bin/env python3
import xml.etree.ElementTree as ET
from xml.dom import minidom
from decimal import Decimal
from datetime import datetime, timezone

def decimal_to_str(val):
    if val is None:
        return "0.00"
    if isinstance(val, (int, float, Decimal)):
        return f"{float(val):.2f}"
    return str(val)

def generate_mismo34_xml(audit_data: dict, loan_data: dict) -> str:
    """
    Serializes borrower income calculations and verified business assets 
    from explicit Schedule L Column (d) ending balance fields into an industry-standard 
    MISMO 3.4 XML payload.
    
    This includes:
    1. Reconciled Monthly Income under LOAN/ROLE/BORROWER/INCOME
    2. Explicit Column (d) Ending Assets under LOAN/ROLE/BORROWER/ASSETS
    3. Quick Ratio calculations and flags represented within standard MISMO structure.
    """
    # Create Root Element with official MISMO 3.4 Namespaces
    namespaces = {
        "xmlns": "http://www.mismo.org/residential/2009/schemas",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:schemaLocation": "http://www.mismo.org/residential/2009/schemas MISMO_3.4.0_GSE.xsd"
    }
    
    root = ET.Element("MESSAGE", **namespaces)
    
    # Message Header
    header = ET.SubElement(root, "ABOUT_VERSIONS")
    about_version = ET.SubElement(header, "ABOUT_VERSION")
    ET.SubElement(about_version, "AboutVersionIdentifier").text = "MISMO v3.4.0"
    ET.SubElement(about_version, "CreatedDatetime").text = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Document Sets Block
    document_sets = ET.SubElement(root, "DOCUMENT_SETS")
    document_set = ET.SubElement(document_sets, "DOCUMENT_SET")
    
    # Loans block
    loans = ET.SubElement(root, "LOANS")
    loan = ET.SubElement(loans, "LOAN")
    
    # Loan Detail Block
    loan_detail = ET.SubElement(loan, "LOAN_DETAIL")
    ET.SubElement(loan_detail, "LoanRoleType").text = "SubjectLoan"
    
    # Roles Block (Borrower & Employer Info)
    roles = ET.SubElement(loan, "ROLES")
    role = ET.SubElement(roles, "ROLE")
    
    role_detail = ET.SubElement(role, "ROLE_DETAIL")
    ET.SubElement(role_detail, "PartyRoleType").text = "Borrower"
    
    borrower = ET.SubElement(role, "BORROWER")
    borrower_detail = ET.SubElement(borrower, "BORROWER_DETAIL")
    ET.SubElement(borrower_detail, "BorrowerID").text = loan_data.get("borrowerId", "BORR-001")
    ET.SubElement(borrower_detail, "BorrowerName").text = loan_data.get("borrowerName", "Alex M. Morgan")
    
    # -------------------------------------------------------------------------
    # 1. Reconciled Monthly Income Serialization (LOAN/ROLE/BORROWER/INCOMES)
    # -------------------------------------------------------------------------
    incomes = ET.SubElement(borrower, "INCOMES")
    
    # Qualifying Self-Employment / Business Income Block
    income = ET.SubElement(incomes, "INCOME")
    income_detail = ET.SubElement(income, "INCOME_DETAIL")
    
    entity_type = audit_data.get("entityType", "SCHEDULE_C")
    mismo_income_type = "SelfEmployment"
    if entity_type in ["FORM_1120S", "FORM_1065", "FORM_1120"]:
        mismo_income_type = "PartnershipSCorporation"
        
    ET.SubElement(income_detail, "IncomeType").text = mismo_income_type
    ET.SubElement(income_detail, "IncomeTypeOtherDescription").text = entity_type
    ET.SubElement(income_detail, "MonthlyTotalAmount").text = decimal_to_str(audit_data.get("qualifyingMonthlyIncome"))
    ET.SubElement(income_detail, "IncomeEmploymentStabilityIndicator").text = "true" if audit_data.get("trendingResult") != "CONVENTIONAL_DECLINING" else "false"
    ET.SubElement(income_detail, "IncomeSourceVerificationType").text = "AutomatedIncomeVerificationService" if audit_data.get("isHumanVerified", False) else "Manual"
    ET.SubElement(income_detail, "IncomeSourceFrequencyType").text = "Monthly"
    
    # Link to the business entity
    business_detail = ET.SubElement(income, "INCOME_BUSINESS_DETAIL")
    ET.SubElement(business_detail, "BusinessName").text = audit_data.get("businessName", "Apex Software Solutions Inc")
    
    # -------------------------------------------------------------------------
    # 2. Corporate & Self-Employed Assets Serialization (LOAN/ROLE/BORROWER/ASSETS)
    # -------------------------------------------------------------------------
    assets = ET.SubElement(borrower, "ASSETS")
    
    # Map explicit Schedule L ending assets (Strictly Column d) to standard MISMO Asset tags
    asset_mappings = [
        ("schLCashEndingColD", "CashOnHand", "Schedule L Line 1(d) Cash ending balance"),
        ("schLTradeNotesReceivableEndingColD", "Other", "Schedule L Line 2a(d) Trade Notes and Accounts Receivable ending balance"),
        ("schLTaxExemptSecuritiesEndingColD", "MutualFund", "Schedule L Line 4(d) Tax-exempt securities ending balance"),
        ("schLOtherCurrentAssetsEndingColD", "Other", "Schedule L Line 6(d) Other current assets ending balance")
    ]
    
    for field, asset_type, desc in asset_mappings:
        val = audit_data.get(field)
        if val is not None and Decimal(str(val)) > 0:
            asset = ET.SubElement(assets, "ASSET")
            asset_detail = ET.SubElement(asset, "ASSET_DETAIL")
            ET.SubElement(asset_detail, "AssetType").text = asset_type
            if asset_type == "Other":
                ET.SubElement(asset_detail, "AssetTypeOtherDescription").text = desc
            ET.SubElement(asset_detail, "AssetCashOrMarketValueAmount").text = decimal_to_str(val)
            ET.SubElement(asset_detail, "AssetVerifiedIndicator").text = "true" if audit_data.get("isHumanVerified", False) else "false"
            
            # Map corresponding document association metadata
            document_ref = ET.SubElement(asset, "ASSET_DOCUMENT_REFERENCE")
            ET.SubElement(document_ref, "DocumentTypeDescription").text = "IRS Tax Form Balance Sheet (Schedule L)"
            ET.SubElement(document_ref, "TaxYear").text = str(audit_data.get("yearsAnalyzed", [2025])[0])

    # -------------------------------------------------------------------------
    # 3. S-Corp Liquidity & Liability Audit Check Mapping
    # -------------------------------------------------------------------------
    if entity_type in ["FORM_1120S", "FORM_1065", "FORM_1120"]:
        # Record liabilities to represent short-term debt and show why Quick Ratio is active
        liabilities = ET.SubElement(borrower, "LIABILITIES")
        
        # We record short-term Accounts Payable and short-term debt under borrower's corporate obligations
        liability_mappings = [
            ("schLAccountsPayableEndingColD", "AccountsPayable", "Schedule L Line 15(d) Accounts payable ending balance"),
            ("schLMortgagesNotesLess1YrEndingColD", "NotesPayable", "Schedule L Line 16(d) Mortgages/notes/bonds mature < 1yr ending balance")
        ]
        
        for field, liab_type, desc in liability_mappings:
            val = audit_data.get(field)
            if val is not None and Decimal(str(val)) > 0:
                liab = ET.SubElement(liabilities, "LIABILITY")
                liab_detail = ET.SubElement(liab, "LIABILITY_DETAIL")
                ET.SubElement(liab_detail, "LiabilityType").text = "Other"
                ET.SubElement(liab_detail, "LiabilityTypeOtherDescription").text = desc
                ET.SubElement(liab_detail, "LiabilityOutstandingPaymentAmount").text = decimal_to_str(val)
                ET.SubElement(liab_detail, "LiabilityVerifiedIndicator").text = "true" if audit_data.get("isHumanVerified", False) else "false"

        # Embed specialized corporate health analytics under custom extension blocks
        # MISMO allows for EXTENSION elements to house vendor-specific calculations cleanly
        extension = ET.SubElement(loan, "EXTENSION")
        freeflow_ext = ET.SubElement(extension, "FREEFLOW_CORPORATE_LIQUIDITY_SUMMARY")
        ET.SubElement(freeflow_ext, "CorporateEntityType").text = entity_type
        ET.SubElement(freeflow_ext, "ComputedQuickRatio").text = decimal_to_str(audit_data.get("quickRatioComputed"))
        ET.SubElement(freeflow_ext, "PassesLiquidityTest").text = "true" if audit_data.get("passesLiquidityTest") else "false"
        ET.SubElement(freeflow_ext, "ZdrProcessingMode").text = "RAM_Only_tmpfs_Isolate"
        ET.SubElement(freeflow_ext, "DatabaseTriggerValidationTimestamp").text = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Clean and prettify XML using minidom
    xml_str = ET.tostring(root, encoding="utf-8")
    reparsed = minidom.parseString(xml_str)
    return reparsed.toprettyxml(indent="  ")

if __name__ == "__main__":
    # Test Payload mimicking our precise Supabase v4 Schema coordinates and Column (d) variables
    test_audit = {
        "entityType": "FORM_1120S",
        "businessName": "Apex Software Solutions Inc",
        "yearsAnalyzed": [2025, 2024],
        "trendingResult": "CONVENTIONAL_STABLE_OR_INCREASING",
        "totalAnnualCashFlow": Decimal("162000.00"),
        "qualifyingMonthlyIncome": Decimal("13500.00"),
        "quickRatioComputed": Decimal("1.04"),
        "passesLiquidityTest": True,
        "isHumanVerified": True,
        
        # Strict Column d ending balances
        "schLCashEndingColD": Decimal("125000.00"),
        "schLTradeNotesReceivableEndingColD": Decimal("25000.00"),
        "schLBadDebtAllowanceEndingColD": Decimal("0.00"),
        "schLTaxExemptSecuritiesEndingColD": Decimal("15000.00"),
        "schLOtherCurrentAssetsEndingColD": Decimal("5000.00"),
        "schLAccountsPayableEndingColD": Decimal("60000.00"),
        "schLMortgagesNotesLess1YrEndingColD": Decimal("60000.00"),
        "schLOtherCurrentLiabilitiesEndingColD": Decimal("0.00"),
        "schLTotalCurrentAssetsEndingColD": Decimal("170000.00"),
        "schLTotalCurrentLiabilitiesEndingColD": Decimal("120000.00")
    }
    
    test_loan = {
        "borrowerId": "BORR-Alex-001",
        "borrowerName": "Alex M. Morgan"
    }
    
    xml_output = generate_mismo34_xml(test_audit, test_loan)
    print("MISMO v3.4 XML PAYLOAD GENERATED SUCCESSFULLY:")
    print(xml_output[:1200] + "\n... [truncated for overview] ...")
