import {sha256} from './canonical.ts';
import type {SoftwareSourceEvidence} from './software-source-reader.ts';

export type ReadinessFinding={code:'CI_FAILURE'|'CI_PENDING'|'NO_TEST_SCRIPT';reference:string;priority:'HIGH'|'MEDIUM';confidence:'CONFIRMED'|'POTENTIAL'};
export type SourceReport={version:1;actor:'SARA_RUNTIME';repository:string;revision:string;tree:string;sourceCollectedAt:string;scope:'BOUNDED_RELEASE_CONFIGURATION_AND_CI';findings:ReadinessFinding[];artifact:{mediaType:'text/markdown';markdown:string;sha256:string;byteLength:number}};
export type ReportBody=Omit<SourceReport,'artifact'>;
const safe=(value:string)=>JSON.stringify(value).replace(/</gu,'\\u003c').replace(/>/gu,'\\u003e');

/** Formatting only. The independent reviewer validates every structured claim
 * against collected evidence before comparing these exact presentation bytes. */
export function renderSourceReport(report:ReportBody,source:SoftwareSourceEvidence):string{
 const lines=['# Bounded repository release-readiness review','',`Repository: ${report.repository}`,`Commit: ${report.revision}`,`Tree: ${report.tree}`,`Source collected: ${report.sourceCollectedAt}`,'','Collector and analyst: SARA_RUNTIME. Deterministic release-configuration and observed-CI checks; independent automated verification is recorded in the separate reviewer receipt. No human-specialist review is claimed.','','## Readiness decision','',report.findings.some(f=>f.code==='CI_FAILURE')?'Follow-up required: at least one observed CI run at this revision failed. Establish whether it applies to the intended release and diagnose that run before relying on it.':'Release readiness is not established by this bounded review. Use the evidence below to decide which release checks still need execution.','',`Inspected inventory: ${source.files.length} selected files; inventory truncated: ${source.inventoryTruncated}. Selection is limited to two manifests, two lockfiles, three runtime configurations, two CI configurations, three test files and four source files. Unsampled material remains unknown. Application logic and dependency vulnerabilities were not comprehensively analyzed.`,'','## Prioritized findings',''];
 if(!report.findings.length)lines.push('No supported material findings from the configured checks within this inspected scope. This does not establish absence of defects.');
 for(const f of report.findings){
  const message=f.code==='CI_FAILURE'?'An observed exact-revision CI run reports failure. This is a CI outcome, not a proved application defect.':f.code==='CI_PENDING'?'An observed exact-revision CI run is unfinished. Its eventual result remains unknown.':'The complete inspected package manifest declares no test or test:* script. Other commands or external CI may run tests; repository-wide test absence is not established.';
  lines.push(`- ${f.priority} / ${f.confidence}: ${message} Evidence: ${f.reference}`);
 }
 lines.push('','## Source observations','');
 for(const file of source.files){
  lines.push(`- ${safe(file.path)} (${file.role}): ${file.permalink}`,`  Full bytes: ${file.byteLength}; blob: ${file.gitBlobSha}; SHA-256: ${file.contentSha256}; excerpt truncated: ${file.sourceTruncated}.`);
  if(file.path.endsWith('package.json')&&!file.sourceTruncated){try{const parsed=JSON.parse(file.sourceText);const scripts=parsed?.scripts;lines.push(`  Declared script names: ${scripts&&typeof scripts==='object'&&!Array.isArray(scripts)?safe(Object.keys(scripts).sort().join(', ')):'not established'}. Commands were not executed.`);}catch{lines.push('  Manifest JSON could not be parsed; script coverage is unknown.');}}
 }
 lines.push('','## Observed CI','',`Exact-head query: ${source.ciQueryStatus??'UNAVAILABLE'}. At most five matching runs were collected; all required branch checks and freshness beyond collection time are not established.`);
 for(const run of source.ciRuns??[])lines.push(`- ${safe(run.name)}: ${safe(run.status)} / ${safe(run.conclusion??'pending')}; revision ${run.headSha}; ${run.url}`);
 if(!source.ciRuns?.length)lines.push('No matching CI evidence is available in this collection. No passing result is inferred.');
 lines.push('','## Limits and next owner decision','','Repository text was treated as untrusted evidence. Target dependencies, package scripts, builds and tests were not executed by SARA. Observed CI was executed by its original CI actor, not by SARA. Browser startup and live-site behavior were not tested by this source-only job. Deployment/source correspondence, mobile behavior, full security coverage and runtime correctness remain unverified.','',...source.limitations.map(x=>`- ${x}`),'','Next decision: review the cited findings and identify the exact outstanding release checks to authorize. A release approval or application repair is not included. Owner usefulness acceptance remains pending.','','## Accounting','','This deterministic owner analysis dispatched no model call. Recorded workflow cash is in the exact runtime receipts. Existing infrastructure allocation and any other unrecorded costs remain unknown; no revenue, customer delivery or profit is claimed.','');
 return lines.join('\n');
}

/** Substantive bounded analysis runs inside the admitted SARA source capability. */
export function createSourceReport(source:SoftwareSourceEvidence):SourceReport{
 const findings:ReadinessFinding[]=[];
 for(const run of source.ciRuns??[]){
  if(run.headSha!==source.immutableCommitSha)continue;
  if(run.status==='completed'&&['failure','timed_out','startup_failure','action_required'].includes(run.conclusion??''))findings.push({code:'CI_FAILURE',reference:run.url,priority:'HIGH',confidence:'CONFIRMED'});
  else if(run.status!=='completed')findings.push({code:'CI_PENDING',reference:run.url,priority:'MEDIUM',confidence:'CONFIRMED'});
 }
 for(const file of source.files){
  if(!/(?:^|\/)package\.json$/u.test(file.path)||file.sourceTruncated)continue;
  try{const parsed=JSON.parse(file.sourceText);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))continue;
   const scripts=parsed.scripts;if(scripts!==undefined&&(!scripts||typeof scripts!=='object'||Array.isArray(scripts)))continue;
   if(!Object.keys(scripts??{}).some(name=>name==='test'||name.startsWith('test:')))findings.push({code:'NO_TEST_SCRIPT',reference:file.permalink,priority:'MEDIUM',confidence:'POTENTIAL'});
  }catch{/* Unparseable manifests remain explicitly unknown in the report. */}
 }
 const body:ReportBody={version:1,actor:'SARA_RUNTIME',repository:source.repository,revision:source.immutableCommitSha,tree:source.treeSha,sourceCollectedAt:source.collectedAt,scope:'BOUNDED_RELEASE_CONFIGURATION_AND_CI',findings};
 const markdown=renderSourceReport(body,source);
 return {...body,artifact:{mediaType:'text/markdown',markdown,sha256:sha256(markdown),byteLength:Buffer.byteLength(markdown)}};
}
