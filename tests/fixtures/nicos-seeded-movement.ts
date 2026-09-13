/** IMPLEMENTATION_AGENT preparation; SYNTHETIC / ISOLATED. This is a bounded
 * adapted copy, not an upstream defect or a live application change. */
import { ISOLATED_MOVEMENT_CONSTANTS, ISOLATED_MOVEMENT_ENTRY, FROZEN_MOVEMENT_REGRESSION, type IsolatedSoftwareRepairInput } from '../../src/isolated-software-repair.ts';
import { sha256 } from '../../src/canonical.ts';

const seededRoute = `import { BOLT_BOT_MOVEMENT_SEQUENCE, type MovementCommand } from './constants.ts';

export type MovementRoute = {
  commands: MovementCommand[];
  wrong: { received: MovementCommand; expected: MovementCommand; step: number } | null;
};
export type MovementRouteAction =
  | { type: 'move'; command: MovementCommand }
  | { type: 'undo' }
  | { type: 'reset' };

export const newMovementRoute = (): MovementRoute => ({ commands: [], wrong: null });

/** Keep a validated prefix. Incorrect taps never consume a step or erase progress. */
export function movementRouteReducer(state: MovementRoute, action: MovementRouteAction): MovementRoute {
  if (action.type === 'reset') return newMovementRoute();
  if (action.type === 'undo') return { commands: state.commands.slice(0, -1), wrong: null };
  const expected = BOLT_BOT_MOVEMENT_SEQUENCE.at(state.commands.length);
  if (!expected) return state;
  if (action.command === expected) {
    return { commands: state.commands, wrong: { received: action.command, expected, step: state.commands.length + 1 } };
  }
  return { commands: [...state.commands, action.command], wrong: null };
}
`;

export function nicosSeededMovementFixture(): IsolatedSoftwareRepairInput {
  return {
    schemaVersion: 1, profile: 'nicos-seeded-comparator-v1', provenance: 'ISOLATED', synthetic: true,
    source: { provenance: 'SUPPLIED', repository: 'BoneManTGRM/Nicos-Adventures', revision: 'ba0cab4a00664426848c34747f7377e59492f56a', path: 'web/src/game/boltBotRoute.ts', sha256: '189ded1d872ad290f2d71cdb829c62244126760520646770f27a859b89c70bdc', adaptedSha256: '0a7099a5e25397a94f43fcdff22acd86bc470a5b310077c26597666e571399e1', preparationActor: 'IMPLEMENTATION_AGENT' },
    candidate: { schemaVersion: 1, candidateKind: 'typescript_program', programName: 'Nicos isolated seeded route', summary: 'Clearly seeded comparator defect in an adapted isolated movement reducer.', limitations: ['SYNTHETIC isolated source subset; no upstream application defect is asserted.'], files: [
      { path: 'src/index.ts', content: ISOLATED_MOVEMENT_ENTRY },
      { path: 'src/constants.ts', content: ISOLATED_MOVEMENT_CONSTANTS },
      { path: 'src/route.ts', content: seededRoute },
      { path: 'tests/route.test.ts', content: FROZEN_MOVEMENT_REGRESSION },
    ] },
    editablePaths: ['src/route.ts'],
    frozenRegression: { path: 'tests/route.test.ts', sha256: sha256(FROZEN_MOVEMENT_REGRESSION) },
    constitutionDigest: 'a'.repeat(64),
  };
}
