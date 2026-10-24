#!/usr/bin/env python3
"""Vendors the folia-major import closure (lattice runtime + lyric parser) into the tool."""
import os
import re
import shutil
import subprocess
import sys

WORKSPACE = r'C:\Users\admin\Documents\deepseek-harness\default-workspace'
FOLIA = os.path.join(WORKSPACE, 'work', 'folia-major-main')
TOOL = os.path.join(WORKSPACE, 'lattice-video')
ENTRY = [
    'src/components/app/lattice/lyrics/createLatticeLyricRuntime.ts',
    'src/utils/lyrics/parserCore.ts',
]

result = subprocess.run(
    [sys.executable, os.path.join(WORKSPACE, 'tools', 'import_closure.py'), FOLIA]
    + [os.path.join(FOLIA, e) for e in ENTRY],
    capture_output=True, text=True)

files = re.findall(r'^\s+(src/\S+\.ts)\s+\d+ lines?$', result.stdout, re.M)
print(f'closure files: {len(files)}')

vendor_root = os.path.join(TOOL, 'vendor', 'folia')
if os.path.isdir(vendor_root):
    shutil.rmtree(vendor_root)
for rel in files:
    dst = os.path.join(vendor_root, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(os.path.join(FOLIA, rel.replace('/', os.sep)), dst)
print(f'vendored into {vendor_root}')
