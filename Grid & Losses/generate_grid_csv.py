import csv
import json
import time

# 8 days from March 23, 2026 to March 30, 2026
start_ts = 1742688000000
ms_per_day = 86400000

# Sample Potential Power Profile (96 values for 24h, 15 min intervals)
potential_profile = [0,0,0,0,5,12,20,35,55,80,120,170,230,300,380,460,530,610,680,730,760,780,790,795,790,770,740,700,650,590,520,440,350,260,180,110,60,25,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]

outage_events = [
    {
        "startTime": "2026-03-24T09:10:00Z",
        "endTime": "2026-03-24T11:20:00Z",
        "eventType": "CEB Grid Fault",
        "energyLost": 5.2,
        "severity": "high"
    },
    {
        "startTime": "2026-03-28T13:05:00Z",
        "endTime": "2026-03-28T13:45:00Z",
        "eventType": "Voltage Sag",
        "energyLost": 1.0,
        "severity": "low"
    }
]

insurance_claims = [
    {
        "date": "2026-02-02",
        "eventType": "Storm Damage",
        "energyLost": 15.2,
        "amount": 350000,
        "status": "Pending"
    },
    {
        "date": "2026-01-14",
        "eventType": "Inverter Fire",
        "energyLost": 28.5,
        "amount": 650000,
        "status": "Approved"
    }
]

rows = []
for i in range(8):
    ts = start_ts + (i * ms_per_day)
    row = {
        "Name": "demo-grid-10mw-lk",
        "Timestamp": ts,
        "contract_cf_target": 0.22,
        "actual_cf_ytd": 0.19 + (i * 0.002), # Slowly changing CF
        "grid_loss_mwh": 42.5 + i,
        "curtailment_loss_mwh": 88.3,
        "revenue_loss_lkr": 1750000 + (i * 10000),
        "insurance_claimable_lkr": 650000,
        "active_power": 742.3 + (i * 5),
        "potential_power_profile": json.dumps(potential_profile),
        "grid_outage_events": json.dumps(outage_events),
        "insurance_claims_data": json.dumps(insurance_claims)
    }
    rows.append(row)

fieldnames = [
    "Name", "Timestamp", 
    "contract_cf_target", "actual_cf_ytd",
    "grid_loss_mwh", "curtailment_loss_mwh", "revenue_loss_lkr", "insurance_claimable_lkr",
    "active_power", "potential_power_profile", "grid_outage_events", "insurance_claims_data"
]

with open('demo_device_grid.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print("CSV generated successfully")
