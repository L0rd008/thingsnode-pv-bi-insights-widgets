#!/usr/bin/env python3
"""
Script to consolidate all ThingsBoard widget files into a single document.
Generates 'All Widgets.txt' with organized sections for each widget.
"""

import os
from pathlib import Path

# Widget folder names
WIDGET_FOLDERS = [
    "Finance KPI Card",
    "DSCR Status Card",
    "LCOE vs TARIFF Card",
    "Investment Returns Panel",
    "Debt Service Panel",
    "Payback Period Timeline"
]

# File extensions to include
FILE_TYPES = {
    ".css": "CSS",
    ".js": "JS", 
    ".html": "HTML",
    "settings.json": "SETTINGS FORM JSON"
}

def read_file_content(file_path):
    """Read and return file content, or error message if not found."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return f"[File not found: {file_path}]"
    except Exception as e:
        return f"[Error reading file: {e}]"

def generate_widget_section(widget_folder, base_path):
    """Generate a formatted section for a single widget."""
    section = []
    section.append("=" * 80)
    section.append(f"  {widget_folder.upper()}")
    section.append("=" * 80)
    section.append("")
    
    widget_path = base_path / widget_folder
    
    # Process each file type
    for file_ext, label in FILE_TYPES.items():
        section.append("-" * 60)
        section.append(f"  {label}")
        section.append("-" * 60)
        
        # Handle settings.json specially (full filename)
        if file_ext == "settings.json":
            file_path = widget_path / "settings.json"
        else:
            file_path = widget_path / file_ext
        
        content = read_file_content(file_path)
        section.append(content)
        section.append("")
    
    return "\n".join(section)

def main():
    """Main function to generate the consolidated file."""
    base_path = Path(__file__).parent
    output_file = base_path / "All Widgets.txt"
    
    # Header
    output = []
    output.append("*" * 80)
    output.append("  THINGSBOARD CUSTOM WIDGETS - CONSOLIDATED CODE")
    output.append("  Sri Lanka 1MW PV Project - ThingsBoard v.4.2.1.1PE")
    output.append("  Design System Standard v1.0")
    output.append("*" * 80)
    output.append("")
    output.append("Table of Contents:")
    for i, widget in enumerate(WIDGET_FOLDERS, 1):
        output.append(f"  {i}. {widget}")
    output.append("")
    output.append("")
    
    # Generate each widget section
    for widget_folder in WIDGET_FOLDERS:
        widget_section = generate_widget_section(widget_folder, base_path)
        output.append(widget_section)
        output.append("")
    
    # Footer
    output.append("=" * 80)
    output.append("  END OF DOCUMENT")
    output.append("=" * 80)
    
    # Write output file
    final_content = "\n".join(output)
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(final_content)
    
    print(f"Successfully generated: {output_file}")
    print(f"Total widgets processed: {len(WIDGET_FOLDERS)}")
    
    # Print file sizes for verification
    for widget in WIDGET_FOLDERS:
        widget_path = base_path / widget
        print(f"\n{widget}:")
        for ext in [".css", ".js", ".html", "settings.json"]:
            if ext == "settings.json":
                fp = widget_path / ext
            else:
                fp = widget_path / ext
            if fp.exists():
                size = fp.stat().st_size
                print(f"  {ext}: {size} bytes")

if __name__ == "__main__":
    main()
