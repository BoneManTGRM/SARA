export type ProductMode='second_brain'|'legacy';
/** Server configuration only. Product mode grants no spending or execution authority. */
export function startupPolicy(env:Readonly<Record<string,string|undefined>>){
 const value=env.SARA_PRODUCT_MODE??'second_brain';
 if(value!=='second_brain'&&value!=='legacy')throw new Error('SARA_PRODUCT_MODE must be second_brain or legacy.');
 const legacy=value==='legacy';
 return Object.freeze({mode:value as ProductMode,bootstrapPaidMandate:legacy,learning:legacy&&env.SARA_AUTONOMOUS_LEARNING_ENABLED==='true',websiteMaintenance:legacy,liveProof:legacy&&env.SARA_LIVE_PROOF_ON_START==='true',codingBenchmark:legacy&&env.SARA_RUN_CODING_SPEED_BENCHMARK==='true',legacyInteractions:legacy,preserveAuthorizedCustomerFulfillment:true as const});
}
