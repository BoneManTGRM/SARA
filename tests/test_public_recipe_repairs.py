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
    def test_pinned_donor_overlays_only_node_npm_headers_and_keeps_nonroot_install(self):
        recipe = dict(repository='preactjs/preact', baseCommit='a' * 40,
                      runtimeImage='node@sha256:' + 'b' * 64,
                      nodeRuntimeImage='node@sha256:' + 'c' * 64,
                      packageManager='npm@6.14.18', browser=True,
                      installCommand=RECIPES[2]['installCommand'])
        lines = builder.dockerfile(recipe).splitlines()
        self.assertEqual(lines[:2], ['FROM ' + recipe['nodeRuntimeImage'] + ' AS public_node_runtime', 'FROM ' + recipe['runtimeImage']])
        copies = [line.split()[2:] for line in lines if line.startswith('COPY ')]
        self.assertEqual(copies, [[p, p] for p in ['/usr/local/bin/node', '/usr/local/lib/node_modules/npm', '/usr/local/include/node']])
        install = lines.index('RUN ' + json.dumps(recipe['installCommand']))
        self.assertIn('USER 1000:1000', lines[:install])
        self.assertNotIn('USER root', lines[lines.index('USER 1000:1000'):])
        self.assertNotIn('Check-Valid-Until', '\n'.join(lines))
        for changed in ['node:14', 'evil@sha256:' + 'd' * 64, 'node@sha256:' + 'd' * 64 + '\nRUN true']:
            with self.assertRaises(ValueError):
                builder.dockerfile(dict(recipe, nodeRuntimeImage=changed))
        with self.assertRaises(ValueError):
            builder.dockerfile(dict(recipe, referencePatch='hidden'))

    def test_qualifier_resolves_both_images_before_build(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'qualification'
            def run(command, **kwargs):
                if 'scripts/prepare-repository-image.py' in command:
                    recipe = json.loads(Path(command[2]).read_text())
                    self.assertEqual(recipe['runtimeImage'], 'node@sha256:' + 'b' * 64)
                    self.assertEqual(recipe['nodeRuntimeImage'], 'node@sha256:' + 'c' * 64)
                    build = output / 'build'
                    build.mkdir()
                    (build / 'build-receipt.json').write_text(json.dumps({'image': 'sha256:' + 'e' * 64}))
                return subprocess.CompletedProcess(command, 0)
            def inspect(command, **kwargs):
                digest = 'c' if command[-1] == RECIPES[2]['nodeRuntimeTag'] else 'b'
                return json.dumps([{'RepoDigests': ['node@sha256:' + digest * 64]}])
            with patch.object(sys, 'argv', ['qualifier', '--index', '2', '--output', str(output)]), patch.object(subprocess, 'run', side_effect=run), patch.object(subprocess, 'check_output', side_effect=inspect), patch('builtins.print'):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(ROOT / 'scripts/qualify-repository-environment.py'), run_name='__main__')
                self.assertEqual(result.exception.code, 0)
            frozen = json.loads((output / 'resolved-recipe.json').read_text())
            self.assertNotIn('nodeRuntimeTag', frozen)

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

    def test_karma_browser_alias_preserves_config_and_rejects_compile_failure(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'compat').mkdir()
            (root / 'compat/server.browser.js').write_text('export default {};')
            package = {'exports': {'./compat/server': {'browser': './compat/server.browser.js', 'import': './compat/server.mjs', 'require': './compat/server.js'}}}
            (root / 'package.json').write_text(json.dumps(package))
            # Shape from the frozen root Karma config: preserve tests, helper,
            # preprocessors, plugin and launchers; override one resolution only.
            config = {'files': [{'pattern': 'test/polyfills.js', 'watched': False}, {'pattern': '{debug,devtools,hooks,compat,test-utils,jsx-runtime,}/test/{browser,shared}/**/*.test.js', 'watched': False, 'type': 'js'}],
                      'preprocessors': {'{debug,devtools,hooks,compat,test-utils,jsx-runtime,}/test/**/*': ['esbuild']},
                      'esbuild': {'singleBundle': False, 'target': 'es2015', 'plugins': [{'name': 'custom'}]},
                      'browsers': ['ChromeNoSandboxHeadless']}
            (root / 'karma.conf.js').write_text('module.exports=' + json.dumps(config))
            fake = root / 'node_modules/karma'
            fake.mkdir(parents=True)
            fake.joinpath('index.js').write_text("""
const fs=require('fs');
exports.config={parseConfig:async (file,options,flags)=>{
 if(!options.singleRun||!flags.promiseConfig||!flags.throwErrors)throw Error('PARSE_OPTIONS');
 return {...require(file),...options};
}};
exports.Server=class {
 constructor(config,done){this.config=config;this.done=done;}
 start(){
  if(process.env.BABEL_NO_MODULES!=='true'||process.env.COVERAGE!=='true')throw Error('UPSTREAM_ENV');
  if(process.env.NODE_OPTIONS!=='--max-old-space-size=768'||process.env.GOGC!=='25')throw Error('MEMORY_ENVELOPE');
  fs.writeFileSync('captured-config.json',JSON.stringify(this.config));
  console.log(process.env.TEST_KARMA_MESSAGE);this.done(Number(process.env.TEST_KARMA_EXIT));
 }
};
""")
            for message, exitcode, expected in [('465 tests completed', 0, 0), ('ERROR [esbuild]: The service was stopped', 0, 1), ('tests failed', 1, 1)]:
                env = dict(os.environ, TEST_KARMA_MESSAGE=message, TEST_KARMA_EXIT=str(exitcode))
                result = subprocess.run(RECIPES[9]['publicTestCommand'], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertIn(message, result.stdout)
                captured = json.loads((root / 'captured-config.json').read_text())
                self.assertEqual(captured.pop('singleRun'), True)
                aliases = captured['esbuild'].pop('alias')
                self.assertEqual(aliases, {'preact/compat/server': str(root / 'compat/server.browser.js')})
                self.assertEqual(captured, config)
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
