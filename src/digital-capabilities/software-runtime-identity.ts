import {canonicalJson,sha256} from '../canonical.ts';
import type {SoftwareRuntime} from './software-work.ts';

export const isSoftwareWorkCapability=(id:string)=>['software-source-inspector','software-journey-tester','software-evidence-reviewer'].includes(id);

/** Trusted adapter configuration, never owner text, credentials or timestamps.
 * Legacy injected adapters have an explicit unversioned identity; production
 * supplies exact configuration digests for both independently bounded paths. */
export function softwareRuntimeDependencyDigest(id:string,runtime:SoftwareRuntime|undefined,scope?:unknown):string{
 const source=runtime?{connected:true,configuration:runtime.configurationIdentity?.sourceDigest??'UNVERSIONED_ADAPTER'}:{connected:false};
 const journey=runtime?{connected:true,configuration:runtime.configurationIdentity?.journeyDigest??'UNVERSIONED_ADAPTER'}:{connected:false};
 return sha256(canonicalJson(id==='software-source-inspector'?source:id==='software-journey-tester'?journey:scope==='INSPECTION'?{source}:{source,journey}));
}
