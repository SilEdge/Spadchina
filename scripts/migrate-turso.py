"""Import a consistent SQLite backup into an EMPTY Turso database and verify every row."""
import argparse
import base64
import json
import sqlite3
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True)
parser.add_argument('--credentials', required=True)
parser.add_argument('--backup', required=True)
args = parser.parse_args()
settings = dict(line.split('=', 1) for line in Path(args.credentials).read_text().splitlines() if '=' in line)
endpoint = settings['TURSO_DATABASE_URL'].replace('libsql://', 'https://').rstrip('/') + '/v2/pipeline'

def request(operation):
    payload = json.dumps({'requests': [operation, {'type': 'close'}]}).encode()
    req = urllib.request.Request(endpoint, data=payload, headers={
        'Authorization': 'Bearer ' + settings['TURSO_AUTH_TOKEN'],
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.load(response)['results'][0]
    if result['type'] == 'error':
        raise RuntimeError(result['error'].get('message', 'Turso operation failed'))
    return result['response']

def query(sql):
    result = request({'type': 'execute', 'stmt': {'sql': sql, 'want_rows': True}})['result']
    def value(item):
        kind = item['type']
        if kind == 'null': return None
        if kind == 'integer': return int(item['value'])
        if kind == 'float': return float(item['value'])
        if kind == 'blob': return base64.b64decode(item['base64'] + '===')
        return item['value']
    return [tuple(value(item) for item in row) for row in result['rows']]

if query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0][0]:
    raise SystemExit('Refusing to overwrite a populated Turso database.')

source = sqlite3.connect(Path(args.source).resolve().as_uri() + '?mode=ro', uri=True)
backup_path = Path(args.backup)
backup_path.parent.mkdir(parents=True, exist_ok=True)
backup = sqlite3.connect(backup_path)
source.backup(backup)
source.close()
assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
dump = '\n'.join(backup.iterdump())
request({'type': 'sequence', 'sql': 'PRAGMA foreign_keys=OFF;\n' + dump})
tables = [row[0] for row in backup.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    expected = list(backup.execute('SELECT * FROM ' + quoted))
    actual = query('SELECT * FROM ' + quoted)
    assert sorted(expected, key=repr) == sorted(actual, key=repr), 'Data mismatch in ' + table
    print(f'{table}: {len(actual)} rows verified')
assert query('PRAGMA integrity_check')[0][0] == 'ok'
backup.close()
print('All tables and values match the SQLite backup.')
