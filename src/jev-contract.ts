/** Reviewed immutable route contracts. No arbitrary endpoint or moving alias is configurable. */
export type JevProvider = 'typesafe' | 'openrouter';
export function jevContract(provider:JevProvider='typesafe') {
 if(provider==='openrouter')return {provider,endpoint:'https://openrouter.ai/api/alpha/decisions',model:'typesafe/jev-1.13',responseModel:'typesafe/jev-1.13-20260917',questionVersion:'sara-relevance-v3-openrouter-20260917',maximumInputTokens:32000,reservationMicrousd:Math.ceil(32000*.042),routeKey:'openrouter:typesafe/jev-1.13:20260917'} as const;
 if(provider!=='typesafe')throw new Error('Unsupported Jev provider.');
 return {provider,endpoint:'https://api.typesafe.ai/v1/systemone',model:'jev-1.13.0',responseModel:'jev-1.13.0',questionVersion:'sara-relevance-v3',maximumInputTokens:65536,reservationMicrousd:Math.ceil(65536*.042),routeKey:'typesafe:jev-1.13.0'} as const;
}
/** Credentials stay on the server and never cross provider routes. Unknown selections fail closed. */
export function jevEnvironment(env:NodeJS.ProcessEnv):{jevProvider:JevProvider;jevDisabled:boolean;jevApiKey?:string} {
 const provider=env.SARA_JEV_PROVIDER??'typesafe';
 if(provider!=='typesafe'&&provider!=='openrouter')return {jevProvider:'typesafe' as const,jevDisabled:true};
 const key=provider==='openrouter'?env.OPENROUTER_API_KEY:env.TYPESAFE_API_KEY;
 return {jevProvider:provider,jevDisabled:env.SARA_JEV_DISABLED==='true',...(key?{jevApiKey:key}:{})};
}
