export type ArmEvaluation={verifiedComplete:boolean;timeMs:number;costUsd:number|null;error:string|null};
export function evaluatePair(control:ArmEvaluation,canary:ArmEvaluation) {
  const valid=[control,canary].every(a=>typeof a.verifiedComplete==="boolean" && a.error===null && Number.isFinite(a.timeMs) && a.timeMs>0);
  const comparable=valid&&control.verifiedComplete&&canary.verifiedComplete;
  const ratio=comparable?control.timeMs/canary.timeMs:null;
  const costKnown=[control,canary].every(a=>a.costUsd!==null&&Number.isFinite(a.costUsd)&&a.costUsd!>=0);
  const costNotHigher=comparable&&costKnown?canary.costUsd!<=control.costUsd!:null;
  return {valid,timeComparable:comparable,speedRatio:ratio,speedIncreasePercent:ratio===null?null:100*(ratio-1),
    costNotHigher,target300PercentMet:comparable&&costNotHigher===true&&ratio!>=4,
    verdict:!valid?'INCONCLUSIVE':control.verifiedComplete&&!canary.verifiedComplete?'REJECT_REGRESSION':
      !control.verifiedComplete&&canary.verifiedComplete?'ACCEPT_FOR_BROADER_MATCHED_TESTING':
      comparable&&costNotHigher===true&&ratio!>1?'ACCEPT_FOR_BROADER_MATCHED_TESTING':
      comparable&&(ratio!<1||costNotHigher===false)?'REJECT_REGRESSION':'INCONCLUSIVE',generalClaimSupported:false};
}
