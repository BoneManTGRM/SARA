import { canonicalJson, sha256 } from "../canonical.ts";
import { ProceduralKnowledgeStore } from "../procedural-intelligence.ts";
import { decidePriorEvidenceReuse } from "../memory-fabric.ts";
import { capabilityContract } from "./registry.ts";
import type { ServiceCapabilityEvidence } from "./types.ts";

/** Kernel-only projection; customer labels cannot supply this evidence. No writes or seeds. */
export async function serviceCapabilityEvidence(stateDirectory:string, ids:readonly string[], policyDigest:string):Promise<ServiceCapabilityEvidence[]> {
  const knowledge = await ProceduralKnowledgeStore.inspectExisting(stateDirectory);
  const result:ServiceCapabilityEvidence[]=[];
  for (const id of [...new Set(ids)].sort()) {
    // Advertising this compiler is not evidence of delivering a service.
    if (id === "service-opportunity-generator") continue;
    const contract = await capabilityContract(id);
    if (!contract) continue;
    const identity = {capabilityId:id,contractDigest:contract.contractDigest,implementationDigest:contract.implementationDigest,policyDigest};
    const procedureEvidenceDigests:string[]=[];
    for (const playbook of knowledge?.playbooks ?? []) {
      if (playbook.status !== "VERIFIED" || playbook.qualificationStatus !== "independently_qualified" || playbook.supersededBy ||
          playbook.procedureApplicabilityIdentity.capabilityId !== id || playbook.procedureApplicabilityIdentity.contractDigest !== contract.contractDigest ||
          !decidePriorEvidenceReuse({expectedIdentity:playbook.procedureApplicabilityIdentity,currentIdentity:identity}).reusable ||
          !decidePriorEvidenceReuse({expectedIdentity:playbook.evidenceReuseIdentity,currentIdentity:identity}).reusable) continue;
      const latest = knowledge!.outcomes.filter(outcome=>outcome.playbookId===playbook.id&&outcome.playbookVersion===playbook.version).at(-1);
      if(knowledge!.outcomes.some(outcome=>outcome.playbookId===playbook.id&&outcome.playbookVersion===playbook.version&&outcome.outcome==='FAILED'))continue;
      if (!latest || latest.outcome !== "VERIFIED" || !latest.freshVerificationEvidence.length) continue;
      procedureEvidenceDigests.push(sha256(canonicalJson({playbook,latest})));
    }
    result.push({id,contractDigest:contract.contractDigest,qualifiedEnabled:contract.status==="ENABLED"&&contract.qualification.status==="PASSED",procedureEvidenceDigests:procedureEvidenceDigests.sort()});
  }
  return result;
}
