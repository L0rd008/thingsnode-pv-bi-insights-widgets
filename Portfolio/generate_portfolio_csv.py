import csv
import json

start_ts = 1742688000000
ms_per_day = 86400000

# --- Portfolio Intelligence Card payloads (4 instances, each just needs 1-2 numeric keys) ---
# DS0 keys per mode:
#   standard (Energy YTD): portfolio_energy_ytd_mwh + portfolio_energy_ytd_target_mwh
#   standard (Revenue YTD): portfolio_revenue_ytd_lkr + portfolio_revenue_ytd_target_lkr
#   risk (Revenue-at-Risk): portfolio_revenue_at_risk_lkr
#   diversity (Diversification Index): portfolio_diversification_index

# --- JSON payloads (same for all days, representing a 3-site 10MW-equivalent portfolio) ---
correlation_matrix = {
    "sites": ["Sabaragamuwa", "North Central", "Southern"],
    "matrix": [
        [1.0, 0.72, 0.38],
        [0.72, 1.0, 0.41],
        [0.38, 0.41, 1.0]
    ]
}

multi_site_energy_ytd = {
    "months": ["Jan", "Feb", "Mar"],
    "unit": "MWh",
    "sites": [
        {"name": "Sabaragamuwa", "data": [1180, 1050, 820]},
        {"name": "North Central", "data": [940, 860, 670]},
        {"name": "Southern",      "data": [650, 590, 460]}
    ]
}

portfolio_compliance_summary = {
    "overall_status": "Non-Compliant",
    "sites": [
        {
            "name": "Sabaragamuwa",
            "capacity_mw": 10,
            "cf_status": "Warning",
            "rar_lkr": 2800000,
            "compliance_flag": "At Risk",
            "status": "warning"
        },
        {
            "name": "North Central",
            "capacity_mw": 6,
            "cf_status": "Normal",
            "rar_lkr": 800000,
            "compliance_flag": "Compliant",
            "status": "healthy"
        },
        {
            "name": "Southern",
            "capacity_mw": 4,
            "cf_status": "Normal",
            "rar_lkr": 450000,
            "compliance_flag": "Compliant",
            "status": "healthy"
        }
    ]
}

portfolio_site_map = [
    {
        "name": "Sabaragamuwa",
        "lat": 6.83,
        "lon": 80.75,
        "capacity_mw": 10,
        "status": "warning",
        "rar_lkr": 2800000,
        "cf_status": "Warning"
    },
    {
        "name": "North Central",
        "lat": 8.30,
        "lon": 80.40,
        "capacity_mw": 6,
        "status": "healthy",
        "rar_lkr": 800000,
        "cf_status": "Normal"
    },
    {
        "name": "Southern",
        "lat": 6.05,
        "lon": 80.22,
        "capacity_mw": 4,
        "status": "healthy",
        "rar_lkr": 450000,
        "cf_status": "Normal"
    }
]

fieldnames = [
    "Name", "Timestamp",
    # Portfolio Intelligence Card - 4 modes
    "portfolio_energy_ytd_mwh", "portfolio_energy_ytd_target_mwh",
    "portfolio_revenue_ytd_lkr", "portfolio_revenue_ytd_target_lkr",
    "portfolio_revenue_at_risk_lkr",
    "portfolio_diversification_index",
    # JSON widgets
    "portfolio_correlation_matrix",
    "multi_site_energy_ytd",
    "portfolio_compliance_summary",
    "portfolio_site_map"
]

rows = []
for i in range(8):
    ts = start_ts + (i * ms_per_day)
    row = {
        "Name": "demo-portfolio-10mw-lk",
        "Timestamp": ts,
        # Portfolio Intelligence Card
        "portfolio_energy_ytd_mwh":         2950 + i * 10,
        "portfolio_energy_ytd_target_mwh":  3200,
        "portfolio_revenue_ytd_lkr":        718000000 + i * 500000,
        "portfolio_revenue_ytd_target_lkr": 750000000,
        "portfolio_revenue_at_risk_lkr":    4050000,
        "portfolio_diversification_index":  0.63,
        # JSON widgets (same every day; latest values widgets only use the most recent row)
        "portfolio_correlation_matrix":     json.dumps(correlation_matrix),
        "multi_site_energy_ytd":            json.dumps(multi_site_energy_ytd),
        "portfolio_compliance_summary":     json.dumps(portfolio_compliance_summary),
        "portfolio_site_map":               json.dumps(portfolio_site_map),
    }
    rows.append(row)

with open("demo_device_portfolio.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print("Portfolio CSV generated successfully.")
