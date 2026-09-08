"""Offline recipe-boundary checks; never downloads dependencies or uses Docker."""
import importlib.util
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_image', ROOT / 'scripts/prepare-repository-image.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
RECIPES = json.loads((ROOT / 'docs/benchmarks/swe-repository-recipes.json').read_text())['tasks']


class RecipeTests(unittest.TestCase):
    def test_public_commands_fit_executor_argument_bounds(self):
        for recipe in RECIPES:
            command = recipe['publicTestCommand']
            self.assertLessEqual(len(command), 32)
            for argument in command:
                self.assertLessEqual(len(argument), 4096)

    def test_pinned_donor_overlays_only_node_npm_headers_and_keeps_nonroot_install(self):
        recipe = dict(repository='preactjs/preact', baseCommit='a' * 40,
                      runtimeImage='node@sha256:' + 'b' * 64,
                      nodeRuntimeImage='node@sha256:' + 'c' * 64,
                      packageManager='npm@6.14.18', browser=True, nodeGypVersion='9.4.1',
                      installCommand=RECIPES[2]['installCommand'])
        lines = builder.dockerfile(recipe).splitlines()
        self.assertEqual(lines[:2], ['FROM ' + recipe['nodeRuntimeImage'] + ' AS public_node_runtime', 'FROM ' + recipe['runtimeImage']])
        copies = [line.split()[2:] for line in lines if line.startswith('COPY ')]
        self.assertEqual(copies, [[p, p] for p in ['/usr/local/bin/node', '/usr/local/lib/node_modules/npm', '/usr/local/include/node']])
        install = lines.index('RUN ' + json.dumps(recipe['installCommand']))
        self.assertIn('USER 1000:1000', lines[:install])
        self.assertNotIn('USER root', lines[lines.index('USER 1000:1000'):])
        self.assertNotIn('Check-Valid-Until', '\n'.join(lines))
        self.assertIn('RUN npm install --global --force node-gyp@9.4.1', lines)
        self.assertIn('ENV npm_config_node_gyp=/usr/local/bin/node-gyp', lines)
        with self.assertRaises(ValueError):
            builder.dockerfile(dict(recipe, nodeGypVersion='latest'))
        for changed in ['node:14', 'evil@sha256:' + 'd' * 64, 'node@sha256:' + 'd' * 64 + '\nRUN true']:
            with self.assertRaises(ValueError):
                builder.dockerfile(dict(recipe, nodeRuntimeImage=changed))
        with self.assertRaises(ValueError):
            builder.dockerfile(dict(recipe, referencePatch='hidden'))

    def test_qualifier_resolves_both_images_before_build(self):
        for extra, seconds, expected_exit in [([], 900, 0), (['--diagnostic-timeout-seconds', '120'], 120, 1)]:
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'qualification'
                def run(command, **kwargs):
                    if 'scripts/prepare-repository-image.py' in command:
                        recipe = json.loads(Path(command[2]).read_text())
                        self.assertEqual(recipe['runtimeImage'], 'node@sha256:' + 'b' * 64)
                        self.assertEqual(recipe['nodeRuntimeImage'], 'node@sha256:' + 'c' * 64)
                        self.assertEqual(recipe['nodeGypVersion'], '9.4.1')
                        build = output / 'build'
                        build.mkdir()
                        (build / 'build-receipt.json').write_text(json.dumps({'image': 'sha256:' + 'e' * 64}))
                    return subprocess.CompletedProcess(command, 0)
                def inspect(command, **kwargs):
                    digest = 'c' if command[-1] == RECIPES[2]['nodeRuntimeTag'] else 'b'
                    return json.dumps([{'RepoDigests': ['node@sha256:' + digest * 64]}])
                with patch.object(sys, 'argv', ['qualifier', '--index', '2', '--output', str(output)] + extra), patch.object(subprocess, 'run', side_effect=run), patch.object(subprocess, 'check_output', side_effect=inspect), patch('builtins.print'):
                    with self.assertRaises(SystemExit) as result:
                        runpy.run_path(str(ROOT / 'scripts/qualify-repository-environment.py'), run_name='__main__')
                    self.assertEqual(result.exception.code, expected_exit)
                frozen = json.loads((output / 'resolved-recipe.json').read_text())
                self.assertNotIn('nodeRuntimeTag', frozen)
                environment = json.loads((output / 'environment.json').read_text())
                summary = json.loads((output / 'summary.json').read_text())
                self.assertEqual(environment['timeoutSeconds'], seconds)
                self.assertEqual(summary['diagnosticOnly'], bool(extra))
                self.assertEqual(summary['qualificationPassed'], not bool(extra))

    def test_axios_grep_is_one_argument_without_shell_interpretation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli = root / 'node_modules/mocha/bin/mocha.js'
            cli.parent.mkdir(parents=True)
            cli.write_text('process.stdout.write(JSON.stringify(process.argv.slice(2)))')
            result = subprocess.run(RECIPES[7]['publicTestCommand'], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = json.loads(result.stdout)
            self.assertEqual(args[args.index('--grep') + 1], '^supports http with nodejs should support HTTPS protocol$|^issues 4999 should not fail with query parsing$')
            self.assertIn('test/unit/**/*.js', args)
            self.assertIn('--invert', args)

    def test_real_esbuild_alias_overrides_frozen_jsconfig_path_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'compat').mkdir()
            (root / 'package.json').write_text(json.dumps({'name': 'preact', 'exports': {'./compat/server': {'browser': './compat/server.browser.js', 'require': './compat/server.js'}}}))
            (root / 'jsconfig.json').write_text(json.dumps({'compilerOptions': {'baseUrl': '.', 'paths': {'preact': ['.'], 'preact/*': ['./*']}}}))
            (root / 'compat/server.js').write_text("import {PassThrough} from 'node:stream';export default PassThrough;")
            (root / 'compat/server.browser.js').write_text("export default 'browser-export';")
            code = """
const esbuild=require('esbuild'),path=require('path'),assert=require('assert');
const root=process.argv[1];
const options={stdin:{contents:'import server from "preact/compat/server"; console.log(server);',resolveDir:root,sourcefile:'entry.js'},bundle:true,write:false,platform:'browser',logLevel:'silent'};
(async()=>{
 await assert.rejects(esbuild.build(options),/Could not resolve "node:stream"/);
 const result=await esbuild.build({...options,alias:{'preact/compat/server':path.join(root,'compat/server.browser.js')}});
 assert(result.outputFiles[0].text.includes('browser-export'));
})().catch(error=>{console.error(error);process.exit(1)});
"""
            result = subprocess.run(['node', '-e', code, directory], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_karma_batches_preserve_full_inventory_support_config_and_all_failures(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'compat').mkdir()
            (root / 'compat/server.browser.js').write_text('export default {};')
            package = {'exports': {'./compat/server': {'browser': './compat/server.browser.js', 'import': './compat/server.mjs', 'require': './compat/server.js'}}}
            (root / 'package.json').write_text(json.dumps(package))
            # Frozen Karma shape plus an asset to verify support-file retention.
            config = {'files': [{'pattern': 'test/polyfills.js', 'watched': False}, {'pattern': '{debug,devtools,hooks,compat,test-utils,jsx-runtime,}/test/{browser,shared}/**/*.test.js', 'watched': False, 'type': 'js'}, {'pattern': 'test/asset.json', 'served': True, 'included': False}],
                      'preprocessors': {'{debug,devtools,hooks,compat,test-utils,jsx-runtime,}/test/**/*': ['esbuild']},
                      'esbuild': {'singleBundle': False, 'target': 'es2015', 'plugins': [{'name': 'custom'}]},
                      'browsers': ['ChromeNoSandboxHeadless']}
            (root / 'karma.conf.js').write_text('module.exports=' + json.dumps(config))
            tests = [str(root / ('test/browser/' + str(i) + '.test.js')) for i in range(5)]
            glob = root / 'node_modules/glob'
            glob.mkdir(parents=True)
            (glob / 'index.js').write_text("const path=require('path');exports.sync=(pattern)=>pattern.includes('*')?" + json.dumps(tests) + ":[path.resolve(pattern)];")
            fake = root / 'node_modules/karma'
            fake.mkdir(parents=True)
            fake.joinpath('index.js').write_text("""
const fs=require('fs'),stdoutWrite=process.stdout.write;
exports.config={parseConfig:async (file,options,flags)=>{
 if(!options.singleRun||!flags.promiseConfig||!flags.throwErrors)throw Error('PARSE_OPTIONS');
 // Match root config's stdout interception; the coordinator must restore its
 // writer before forwarding complete child log chunks.
 const original=process.stdout.write;
 process.stdout.write=function(chunk,...args){if(String(chunk).includes('BATCH_LOG_SENTINEL'))return true;return original.call(this,chunk,...args);};
 return {...require(file),...options};
}};
exports.Server=class {
 constructor(config,done){this.config=config;this.done=done;}
 start(){
  if(process.env.BABEL_NO_MODULES!=='true'||process.env.COVERAGE!=='true')throw Error('UPSTREAM_ENV');
  fs.appendFileSync('captured-config.jsonl',JSON.stringify({config:this.config,pid:process.pid})+'\\n');
  stdoutWrite.call(process.stdout,'BATCH_LOG_SENTINEL\\n');
  console.log(process.env.TEST_KARMA_MESSAGE);
  if(process.env.TEST_KARMA_MESSAGE==='child-killed')process.kill(process.pid,'SIGKILL');
  if(process.env.TEST_KARMA_MESSAGE==='stream-gate'){const timer=setInterval(()=>{if(fs.existsSync('release')){clearInterval(timer);this.done(0)}},10);return;}
  const first=this.config.files.some(f=>f.pattern.endsWith('/0.test.js'));
  this.done(process.env.TEST_KARMA_MESSAGE==='first-batch-fails'?(first?1:0):Number(process.env.TEST_KARMA_EXIT));
 }
};
""")
            for message, exitcode, expected in [('all assertions passed', 0, 0), ('ERROR [esbuild]: The service was stopped', 0, 1), ('tests failed', 1, 1), ('child-killed', 0, 1), ('first-batch-fails', 0, 1)]:
                captured_path = root / 'captured-config.jsonl'
                if captured_path.exists():
                    captured_path.unlink()
                env = dict(os.environ, TEST_KARMA_MESSAGE=message, TEST_KARMA_EXIT=str(exitcode))
                result = subprocess.run(RECIPES[9]['publicTestCommand'], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                records = [json.loads(line) for line in captured_path.read_text().splitlines()]
                self.assertEqual(len(records), 2)
                self.assertEqual(len({record['pid'] for record in records}), 2)
                scheduled = []
                for record in records:
                    captured = record['config']
                    self.assertEqual(captured.pop('singleRun'), True)
                    batchfiles = captured.pop('files')
                    scheduled.extend(f['pattern'] for f in batchfiles if f['pattern'].endswith('.test.js'))
                    self.assertIn(config['files'][0], batchfiles)
                    self.assertIn(config['files'][2], batchfiles)
                    for f in batchfiles:
                        if f['pattern'].endswith('.test.js'):
                            self.assertEqual({k:v for k,v in f.items() if k!='pattern'}, {'watched': False, 'type': 'js'})
                    self.assertEqual(captured['esbuild'].pop('alias'), {'preact/compat/server': str(root / 'compat/server.browser.js')})
                    self.assertEqual(captured, {k:v for k,v in config.items() if k!='files'})
                self.assertEqual(scheduled, tests)
                jsonlines = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
                diagnostics = [line for line in jsonlines if line.get('event') == 'public_test_process']
                self.assertEqual(len(diagnostics), 2)
                self.assertEqual([file for d in diagnostics for file in d['files']], tests)
                self.assertEqual(result.stdout.count('BATCH_LOG_SENTINEL'), 2)
                self.assertEqual(result.stdout.count(message), 2)
                for index, diagnostic in enumerate(diagnostics):
                    expected_status = None if message=='child-killed' else ((1 if index==0 else 0) if message=='first-batch-fails' else exitcode)
                    self.assertEqual(diagnostic['status'], expected_status)
                    self.assertEqual(diagnostic['signal'], 'SIGKILL' if message=='child-killed' else None)
                    self.assertIn('memoryEventsBefore', diagnostic)
                    self.assertIn('memoryEventsAfter', diagnostic)
                summary = next(line for line in jsonlines if line.get('event')=='public_test_summary')
                self.assertEqual(summary['scheduledTests'], len(tests))
                self.assertEqual(summary['failed'], bool(expected))
            # Child output must arrive before the child finishes, so timeout
            # evidence survives a stalled browser or test. Buffered spawnSync fails.
            import select
            import time
            env = dict(os.environ, TEST_KARMA_MESSAGE='stream-gate', TEST_KARMA_EXIT='0')
            process = subprocess.Popen(RECIPES[9]['publicTestCommand'], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            prefix = b''
            try:
                deadline = time.monotonic() + 3
                while b'BATCH_LOG_SENTINEL' not in prefix and time.monotonic() < deadline:
                    if select.select([process.stdout], [], [], 0.1)[0]:
                        chunk = os.read(process.stdout.fileno(), 65536)
                        if not chunk:
                            break
                        prefix += chunk
                self.assertIn(b'public_test_batch_start', prefix)
                self.assertIn(b'BATCH_LOG_SENTINEL', prefix)
                self.assertIsNone(process.poll())
            finally:
                (root / 'release').write_text('ready')
                tail, errors = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, errors)
            self.assertIn(b'public_test_summary', prefix + tail)
            package['exports']['./compat/server']['browser'] = './compat/server.js'
            (root / 'package.json').write_text(json.dumps(package))
            result = subprocess.run(RECIPES[9]['publicTestCommand'], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('PREACT_BROWSER_EXPORT_DRIFT', result.stderr)

    def test_sharp_install_only_targets_frozen_dependency_and_fails_version_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'node_modules/sharp'
            package.mkdir(parents=True)
            binaries = root / 'bin'
            binaries.mkdir()
            log = root / 'commands'
            for executable in ['yarn', 'npm']:
                path = binaries / executable
                path.write_text('#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "' + str(log) + '"\n')
                path.chmod(0o755)
            import os
            env = dict(os.environ, PATH=str(binaries) + ':' + os.environ['PATH'])
            (package / 'package.json').write_text('{"version":"0.32.6"}')
            run = subprocess.run(RECIPES[5]['installCommand'], cwd=root, env=env, capture_output=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('npm --prefix node_modules/sharp run install', log.read_text())
            log.unlink()
            (package / 'package.json').write_text('{"version":"0.33.0"}')
            run = subprocess.run(RECIPES[5]['installCommand'], cwd=root, env=env, capture_output=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertNotIn('npm ', log.read_text())


if __name__ == '__main__':
    unittest.main()
