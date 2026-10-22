"""Use only the isolated reader-js-check project; session data stays in /tmp."""
import json
import pathlib
import subprocess
import time
import urllib.request

name = 'reader-js-check'
root = pathlib.Path('/tmp/reader-js-integration-check')
session = json.loads((root / 'session.json').read_text())
plugin = 'reader.source.novelweb'
base = 'http://127.0.0.1:4397'

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def container():
    return json.loads(docker('inspect', name))[0]

assert container()['Config']['Labels']['com.docker.compose.project'] == name

def api(path, body=None, method=None):
    request = urllib.request.Request(base + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + session['token'], **({'Content-Type': 'application/json'} if body is not None else {})}, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)

process_script = r"""
const fs=require('node:fs'),result={};
for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){
 let args;try{args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');}catch{continue;}
 let role;
 if(args[1]==='dist/main.js')role='reader';
 else if(args[1]?.startsWith('/data/plugins/')&&args[1].endsWith('/main.mjs'))role='plugin';
 else if(args[1]?.startsWith('/tmp/reader-plugin-runtime-')&&args[1].endsWith('/browser-bridge/server.mjs'))role='browser';
 else if(args[0]?.endsWith('/chromium')&&args.includes('--remote-debugging-pipe'))role='chromium';
 if(role){const status=fs.readFileSync('/proc/'+pid+'/status','utf8');result[role]={pid:Number(pid),uid:Number(status.match(/Uid:\s+(\d+)/)[1]),caps:status.match(/CapEff:\s+(\w+)/)[1]};}
}
result.active=JSON.parse(fs.readFileSync('/tmp/reader-plugin-services/status.json','utf8')).active;
result.directories=fs.readdirSync('/tmp').filter(p=>p.startsWith('reader-plugin-runtime-'));
console.log(JSON.stringify(result));
"""

def processes():
    return json.loads(docker('exec', name, 'node', '-e', process_script))

def wait(predicate):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = processes()
        if predicate(result):
            return result
        time.sleep(0.5)
    raise AssertionError('lifecycle transition timed out')

def stopped(p):
    return not p['active'] and not any(role in p for role in ['browser', 'chromium']) and not p['directories']

def check_source():
    result = api('/api/v1/sources/' + session['source'] + '/pages/legacy-sources',
        {'action': 'manage', 'values': {'source': session['ruleId'], 'command': 'check', 'query': '剑来'}})
    assert '检查通过' in json.dumps(result, ensure_ascii=False)

def wait_reader():
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base + '/api/v1/health', timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.5)
    raise AssertionError('Reader startup timed out')

initial = processes()
assert all(initial[role]['uid'] == uid and initial[role]['caps'] == '0000000000000000'
    for role, uid in [('reader', 100), ('plugin', 100), ('browser', 1001), ('chromium', 1001)])
original_reader = initial['reader']['pid']
restarts = container()['RestartCount']

for role in ['browser', 'chromium']:
    before = processes()
    docker('exec', name, 'node', '-e', "process.kill(Number(process.argv[1]),'SIGKILL')", str(before[role]['pid']))
    wait(lambda p: all(r in p for r in ['browser', 'chromium']) and p['browser']['pid'] != before['browser']['pid'])
    check_source()
    assert processes()['reader']['pid'] == original_reader and container()['RestartCount'] == restarts
    print(f'PASS: {role} failure recovers plugin services without restarting Reader', flush=True)

api('/api/v1/plugins/' + plugin, {'enabled': False}, 'PATCH')
wait(stopped)
api('/api/v1/plugins/' + plugin, {'enabled': True}, 'PATCH')
assert stopped(processes())
check_source()
print('PASS: disable stops the browser service and cleans runtime files; enable starts them on demand', flush=True)

before = processes()
docker('exec', name, 'node', '-e', "process.kill(Number(process.argv[1]),'SIGKILL')", str(before['plugin']['pid']))
wait(stopped)
api('/api/v1/plugins/' + plugin, {'enabled': True}, 'PATCH')
check_source()
print('PASS: forced plugin termination cleans services; official re-enable restores them', flush=True)

api('/api/v1/plugins/' + plugin, method='DELETE')
wait(stopped)
assert api('/api/v1/auth/me')['user']['id'] == session['userId']
api('/api/v1/plugins', {'trusted': True, 'folder': 'novel-web'})
check_source()
print('PASS: uninstall stops services and preserves account and source data; reinstall works', flush=True)

boundary = 'readerPluginUpgradeBoundary'
data = (f'--{boundary}\r\nContent-Disposition: form-data; name="trusted"\r\n\r\ntrue\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="reader-novel-web-1.5.1.tgz"\r\nContent-Type: application/gzip\r\n\r\n').encode()
data += (root / 'reader-novel-web-1.5.1.tgz').read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
request = urllib.request.Request(base + '/api/v1/plugins/upload', data=data,
    headers={'Authorization': 'Bearer ' + session['token'], 'Content-Type': 'multipart/form-data; boundary=' + boundary})
with urllib.request.urlopen(request, timeout=120) as response:
    upgraded = json.load(response)['plugin']
assert upgraded['version'] == '1.5.1' and upgraded['updated']
wait(stopped)
check_source()
header = docker('exec', name, 'node', '-e', "fetch('http://reader-browser:8081/health').then(r=>console.log(r.headers.get('x-plugin-version')))" )
assert header == 'upgrade-fixture'
assert processes()['reader']['pid'] == original_reader and container()['RestartCount'] == restarts
print('PASS: official upload upgrades bundled service code without rebuilding/restarting Reader', flush=True)

docker('stop', '--time', '60', name)
assert container()['State']['ExitCode'] == 0
docker('start', name)
wait_reader()
wait(stopped)
check_source()
print('PASS: graceful container shutdown; persisted plugin/account restart on demand', flush=True)
restarts = container()['RestartCount']
docker('exec', name, 'node', '-e', "process.kill(Number(process.argv[1]),'SIGKILL')", str(processes()['reader']['pid']))
deadline = time.monotonic() + 90
while container()['RestartCount'] == restarts and time.monotonic() < deadline:
    time.sleep(0.5)
assert container()['RestartCount'] == restarts + 1
wait_reader()
wait(stopped)
check_source()
assert api('/api/v1/auth/me')['user']['id'] == session['userId']
print('PASS: main crash restarts container; plugin starts on demand; account survives', flush=True)
(root / 'lifecycle-results.json').write_text(json.dumps({'helperFailureRecovery': True, 'chromiumFailureRecovery': True,
    'disableEnable': True, 'forcedPluginExitCleanup': True, 'uninstallReinstall': True, 'officialUploadUpgrade': True,
    'upgradeChangesServiceCode': True, 'mainNotRestartedByPluginActions': True, 'gracefulShutdown': True, 'mainCrashRecovery': True}, indent=2))
