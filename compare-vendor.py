#!/usr/bin/env python3
"""Compare vendored folia files against upstream main, by git blob SHA.

GitHub's tree API returns each file's blob SHA, which is exactly the SHA-1 that
`git hash-object` computes on the local file. So this verifies the vendored copy against
upstream without downloading the repository (the repo is ~54 MB and slow to clone).

Usage:
    python compare-vendor.py [--upstream-ref main] [--tree-json PATH]

The upstream tree JSON is fetched with curl -sk (needed on networks where the certificate
revocation check fails; codeload/API otherwise rejects the request). If the file already
exists it is reused, so the comparison works offline after the first run.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TREE = os.path.join(HERE, '.render-work', 'folia-tree.json')
UPSTREAM = 'chthollyphile/folia-major'


def fetch_tree(ref, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = f'https://api.github.com/repos/{UPSTREAM}/git/trees/{ref}?recursive=1'
    print(f'[*] fetching upstream tree ({ref}) -> {dest}')
    r = subprocess.run(['curl', '-skL', '--max-time', '180', '-o', dest, url],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.getsize(dest):
        sys.exit(f'failed to fetch upstream tree: {r.stderr.strip()}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upstream-ref', default='main')
    ap.add_argument('--tree-json', default=DEFAULT_TREE)
    ap.add_argument('--vendor', default=os.path.join(HERE, 'vendor', 'folia'))
    args = ap.parse_args()

    if not os.path.exists(args.tree_json):
        fetch_tree(args.upstream_ref, args.tree_json)

    with open(args.tree_json, 'r', encoding='utf-8') as f:
        tree = json.load(f)
    sha_by_path = {e['path']: e['sha'] for e in tree.get('tree', []) if e.get('type') == 'blob'}

    local = []
    src_root = os.path.join(args.vendor, 'src')
    for root, _dirs, files in os.walk(src_root):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, args.vendor).replace(os.sep, '/')
            local.append((rel, full))
    local.sort()

    same, differ, missing = [], [], []
    for rel, full in local:
        up = sha_by_path.get(rel)
        if up is None:
            missing.append(rel)
            continue
        got = subprocess.run(['git', 'hash-object', full],
                             capture_output=True, text=True).stdout.strip()
        (same if got == up else differ).append((rel, got, up))

    print(f'upstream ref   : {args.upstream_ref} ({UPSTREAM})')
    print(f'vendored files : {len(local)}')
    print(f'identical      : {len(same)}')
    print(f'differing      : {len(differ)}   <- expected: the 2 documented patches only')
    print(f'not in upstream: {len(missing)}')
    if differ:
        print('\n=== DIFFERING (path | ours | upstream) ===')
        for rel, got, up in differ:
            print(f'  {rel}\n     ours={got}\n     up  ={up}')
    if missing:
        print('\n=== NOT FOUND UPSTREAM ===')
        for rel in missing:
            print(f'  {rel}')
    return 0 if not missing else 1


if __name__ == '__main__':
    sys.exit(main())