// Official pinned Chrome for Testing; build-time packaging only.
// https://googlechromelabs.github.io/chrome-for-testing/
// https://github.com/GoogleChromeLabs/chrome-for-testing#how-to-install-the-system-level-dependencies-required-for-archived-linux64-binaries
// https://railpack.com/config/file/
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {chmod,mkdir,mkdtemp,readFile,rename,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {get} from 'node:https';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const BROWSER_RELEASE=Object.freeze({
 version:'153.0.8010.36',platform:'linux64',
 url:'https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.36/linux64/chrome-linux64.zip',
 bytes:195711476,
 sha256:'167a098c4fdec156b58a9f678c90a84f9072d789f9c6e7b35496a6987b8b7ef8',
 dependencyManifestSha256:'a0d27c5efb2337bb3cdc9e5467419ba13f2a6a7137c849f1c000c347ca5d5c94',
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function verifyBrowserArchive(archive){
 if((await stat(archive)).size!==BROWSER_RELEASE.bytes)throw new Error('SOFTWARE_BROWSER_ARCHIVE_SIZE_MISMATCH');
 const digest=createHash('sha256');
 for await(const chunk of createReadStream(archive))digest.update(chunk);
 if(digest.digest('hex')!==BROWSER_RELEASE.sha256)throw new Error('SOFTWARE_BROWSER_ARCHIVE_HASH_MISMATCH');
 const names=execFileSync('unzip',['-Z1',archive],{encoding:'utf8',timeout:15000,maxBuffer:512*1024}).trim().split('\n');
 if(names.some(name=>!name.startsWith('chrome-linux64/')||name.split('/').includes('..')||name.includes('\\')))throw new Error('SOFTWARE_BROWSER_ARCHIVE_PATH_DENIED');
 const dependencies=execFileSync('unzip',['-p',archive,'chrome-linux64/deb.deps'],{timeout:15000,maxBuffer:16384});
 if(hash(dependencies)!==BROWSER_RELEASE.dependencyManifestSha256)throw new Error('SOFTWARE_BROWSER_DEPENDENCY_MANIFEST_MISMATCH');
 return {...BROWSER_RELEASE,dependencyManifest:dependencies.toString('utf8')};
}

async function download(archive){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await new Promise((resolve,reject)=>{
   const call=get(BROWSER_RELEASE.url,{signal:controller.signal,headers:{'Accept-Encoding':'identity'}},resolve);
   call.once('error',reject);
  });
  if(response.statusCode!==200||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new Error('SOFTWARE_BROWSER_DOWNLOAD_REJECTED');}
  let bytes=0;
  const bound=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>BROWSER_RELEASE.bytes?new Error('SOFTWARE_BROWSER_DOWNLOAD_LIMIT'):null,chunk);}});
  await pipeline(response,bound,createWriteStream(archive,{flags:'wx',mode:0o600}),{signal:controller.signal});
 }finally{clearTimeout(timeout);}
}

export async function prepareSoftwareBrowser(){
 if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Software browser packaging is qualified only for linux-x64.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const cache=join(root,'.cache');
 await mkdir(cache,{recursive:true,mode:0o755});
 const temporary=await mkdtemp(join(tmpdir(),'sara-browser-download-'));
 const stage=await mkdtemp(join(cache,'.software-browser-build-'));
 const destination=join(cache,'software-browser');
 try{
  const archive=join(temporary,'chrome.zip');
  await download(archive);
  const release=await verifyBrowserArchive(archive);
  execFileSync('unzip',['-q',archive,'-d',stage],{timeout:60000,maxBuffer:16384});
  const binary=join(stage,'chrome-linux64','chrome');
  const version=execFileSync(binary,['--version'],{encoding:'utf8',timeout:10000,maxBuffer:16384}).trim();
  if(!version.endsWith(BROWSER_RELEASE.version))throw new Error('SOFTWARE_BROWSER_VERSION_MISMATCH');
  const sandbox=await stat(join(stage,'chrome-linux64','chrome_sandbox'));
  if(!sandbox.isFile()||(sandbox.mode&0o7777)!==0o755)throw new Error('SOFTWARE_BROWSER_SANDBOX_PERMISSIONS_CHANGED');
  const config=JSON.parse(await readFile(join(root,'railpack.json'),'utf8'));
  const requestedPackages=config.deploy.aptPackages.filter(name=>name!=='...');
  const installedBuildPackages=execFileSync('dpkg-query',['-W','-f=${binary:Package}\t${Version}\t${Architecture}\n',...requestedPackages],{encoding:'utf8',timeout:10000,maxBuffer:32768}).trim().split('\n').sort();
  const binaryHash=createHash('sha256');for await(const chunk of createReadStream(binary))binaryHash.update(chunk);
  const manifest={schemaVersion:1,provenance:'BUILD',...release,executableSha256:binaryHash.digest('hex'),observedVersion:version,requestedRuntimePackages:requestedPackages,installedBuildPackages,sandboxMode:'unprivileged-linux-namespaces',limitations:['Packaging and --version do not prove a usable host sandbox.','Runtime apt versions and sandbox support require exact deployed-image evidence. No sandbox bypass is permitted.']};
  await writeFile(join(stage,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,{mode:0o644});
  await mkdir(join(stage,'bin'),{mode:0o755});
  await symlink('../chrome-linux64/chrome',join(stage,'bin','google-chrome'));
  await chmod(stage,0o755);
  // Only replace this script's reproducible build output, never /data or state.
  await rm(destination,{recursive:true,force:true});
  await rename(stage,destination);
  console.log(JSON.stringify({softwareBrowser:'PACKAGED',version:BROWSER_RELEASE.version,archiveSha256:BROWSER_RELEASE.sha256,manifest:'.cache/software-browser/manifest.json',sandboxVerified:false}));
 }finally{await rm(temporary,{recursive:true,force:true});await rm(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]==='--check-archive'&&process.argv.length===4){const release=await verifyBrowserArchive(resolve(process.argv[3]));console.log(JSON.stringify({verified:true,version:release.version,sha256:release.sha256,dependencyManifestSha256:release.dependencyManifestSha256}));}
 else if(process.argv.length===2)await prepareSoftwareBrowser();
 else throw new Error('Use no arguments for packaging, or --check-archive PATH for offline verification.');
}
