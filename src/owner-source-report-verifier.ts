import {createHash} from 'node:crypto';
import {canonicalJson,sha256} from './canonical.ts';
import {renderSourceReport,type SourceReport} from './owner-source-report.ts';
import type {SoftwareSourceEvidence} from './software-source-reader.ts';

/** Independent semantic validation: never generates or repairs author findings.
 * Shared rendering validates presentation only after the source predicates pass. */
export function verifySourceReport(source:SoftwareSourceEvidence,report:SourceReport,repository:string,revision?:string):string[]{
 try{
  const errors:string[]=[];
  if(report.version!==1||report.actor!=='SARA_RUNTIME'||report.scope!=='BOUNDED_RELEASE_CONFIGURATION_AND_CI'||report.repository!==repository||source.repository!==repository||report.revision!==source.immutableCommitSha||revision&&report.revision!==revision||report.tree!==source.treeSha||report.sourceCollectedAt!==source.collectedAt)return ['Report target, revision, actor or scope is mismatched.'];
  if(source.actor!=='SARA_RUNTIME'||source.evidenceLabel!=='EXTERNAL_READ_ONLY'||source.collectionMode!=='anonymous_read_only'||!source.files.length||source.files.length>16||new Set(source.files.map(f=>f.path)).size!==source.files.length)return ['Source collection is missing, duplicated or has unsupported provenance.'];
  for(const file of source.files){
   if(file.permalink!==`${repository}/blob/${report.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`||file.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\u0000-\u001f]/u.test(file.path)||file.trust!=='UNTRUSTED_SOURCE')errors.push('Source reference is not bound to the requested target.');
   if(!file.sourceTruncated&&(Buffer.byteLength(file.sourceText)!==file.byteLength||sha256(file.sourceText)!==file.contentSha256||createHash('sha1').update(`blob ${file.byteLength}\0`).update(file.sourceText).digest('hex')!==file.gitBlobSha))errors.push('Complete source text failed its independent byte/hash check.');
  }
  const runs=source.ciRuns??[];
  if(runs.length>5||new Set(runs.map(r=>r.id)).size!==runs.length||runs.some(r=>r.headSha!==report.revision||r.url!==`${repository}/actions/runs/${r.id}`)||runs.length&&source.ciQueryStatus!=='OBSERVED')errors.push('CI evidence is mismatched or not observed.');
  const expectedReferences=new Set<string>();
  for(const run of runs)if(run.status!=='completed'||['failure','timed_out','startup_failure','action_required'].includes(run.conclusion??''))expectedReferences.add(run.url);
  for(const file of source.files.filter(f=>/(?:^|\/)package\.json$/u.test(f.path)&&!f.sourceTruncated)){
   try{const manifest=JSON.parse(file.sourceText);if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))continue;const scripts=manifest.scripts;
    if(scripts!==undefined&&(!scripts||typeof scripts!=='object'||Array.isArray(scripts)))continue;
    if(!Object.keys(scripts??{}).some(key=>/^test(?::|$)/u.test(key)))expectedReferences.add(file.permalink);
   }catch{/* Unknown parse coverage is disclosed; no absence claim is allowed. */}
  }
  if(!Array.isArray(report.findings)||new Set(report.findings.map(f=>f.reference)).size!==report.findings.length||canonicalJson([...expectedReferences].sort())!==canonicalJson(report.findings.map(f=>f.reference).sort()))errors.push('Report omits relevant evidence or adds unsupported findings.');
  for(const finding of report.findings){
   const run=runs.find(r=>r.url===finding.reference);
   if(finding.code==='CI_FAILURE'){
    if(!run||run.status!=='completed'||!['failure','timed_out','startup_failure','action_required'].includes(run.conclusion??'')||finding.priority!=='HIGH'||finding.confidence!=='CONFIRMED')errors.push('Unsupported CI failure claim.');
   }else if(finding.code==='CI_PENDING'){
    if(!run||run.status==='completed'||finding.priority!=='MEDIUM'||finding.confidence!=='CONFIRMED')errors.push('Unsupported pending CI claim.');
   }else if(finding.code==='NO_TEST_SCRIPT'){
    if(run||!expectedReferences.has(finding.reference)||finding.priority!=='MEDIUM'||finding.confidence!=='POTENTIAL')errors.push('Unsupported test-coverage claim.');
   }else errors.push('Unknown finding type.');
  }
  const artifact=report.artifact;
  if(artifact.mediaType!=='text/markdown'||artifact.markdown!==renderSourceReport(report,source)||artifact.sha256!==sha256(artifact.markdown)||artifact.byteLength!==Buffer.byteLength(artifact.markdown))errors.push('Report content or artifact identity failed verification.');
  return [...new Set(errors)];
 }catch{return ['Malformed report or source evidence was rejected.'];}
}
