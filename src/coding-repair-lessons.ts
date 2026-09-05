import { canonicalJson, sha256 } from "./canonical.ts";
import {
  buildCodingRepairAttemptLesson as buildBaseCodingRepairAttemptLesson,
} from "./coding-repair-lessons-base.ts";
import {
  boundInformationRichCodingRepairAttemptLessons,
  digestCodingRepairModelAttemptLessons,
  enrichCodingRepairAttemptLesson,
  projectCodingRepairAttemptLessonsForModel,
} from "./coding-repair-information-lessons.ts";
import type { CodingRepairAttemptLesson } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export * from "./coding-repair-lessons-base.ts";
export {
  boundInformationRichCodingRepairAttemptLessons,
  digestCodingRepairModelAttemptLessons,
  enrichCodingRepairAttemptLesson,
  projectCodingRepairAttemptLessonsForModel,
};

type BaseAttemptLessonInput = Parameters<typeof buildBaseCodingRepairAttemptLesson>[0];

export function buildCodingRepairAttemptLesson(
  input: BaseAttemptLessonInput & {
    beforeCandidate?: ProgramCandidateProposal;
    afterCandidate?: ProgramCandidateProposal;
  },
): CodingRepairAttemptLesson {
  return enrichCodingRepairAttemptLesson({
    lesson: buildBaseCodingRepairAttemptLesson(input),
    before: input.before,
    after: input.after,
    beforeCandidate: input.beforeCandidate,
    afterCandidate: input.afterCandidate,
  });
}

export function boundCodingRepairAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): CodingRepairAttemptLesson[] {
  return boundInformationRichCodingRepairAttemptLessons(lessons);
}

export function digestCodingRepairAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): string {
  return sha256(canonicalJson(boundInformationRichCodingRepairAttemptLessons(lessons)));
}

