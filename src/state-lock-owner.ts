import {isAbsolute,relative,resolve} from 'node:path';

/** Railway prevents simultaneous deployments mounting a service volume.
 * A legacy PID can be reused after that handoff. Only the current process's
 * own PID, recorded before this process existed, can use this narrow recovery.
 * Unknown platforms, paths, timestamps and other live PIDs remain locked. */
export function abandonedExclusiveVolumeSelfPid(input:{
 owner:{pid?:unknown;acquiredAt?:unknown};selfPid:number;processStartedAt:number;
 stateDirectory:string;volumeMount?:string;deploymentId?:string;heldInThisProcess:boolean;
}):boolean{
 if(input.heldInThisProcess||input.owner.pid!==input.selfPid||!input.volumeMount||!isAbsolute(input.volumeMount)||!input.deploymentId||!/^[A-Za-z0-9-]{8,}$/u.test(input.deploymentId)||typeof input.owner.acquiredAt!=='string')return false;
 const inside=relative(resolve(input.volumeMount),resolve(input.stateDirectory));
 if(inside==='..'||inside.startsWith('../')||isAbsolute(inside))return false;
 const acquired=Date.parse(input.owner.acquiredAt);
 return Number.isFinite(acquired)&&Number.isFinite(input.processStartedAt)&&acquired<input.processStartedAt-1000;
}
