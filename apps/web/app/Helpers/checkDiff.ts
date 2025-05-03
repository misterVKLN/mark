import { Choice, QuestionVariants } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import { useMemo } from "react";

// Helper function to safely compare values that might be null/undefined
function safeCompare<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): boolean {
  // Both null/undefined should be considered equal
  if (a == null && b == null) return true;

  // One is null/undefined and the other isn't
  if (a == null || b == null) return false;

  // Both are defined, compare with stringify for objects/arrays
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Direct comparison for primitives
  return a === b;
}

// Helper to deep compare arrays safely with custom comparison logic
function safeArrayCompare<T>(
  a: T[] | null | undefined,
  b: T[] | null | undefined,
  compareFn?: (itemA: T, itemB: T) => boolean,
): boolean {
  // Handle null/undefined cases
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  // Length check
  if (a.length !== b.length) return false;

  // Empty arrays are equal
  if (a.length === 0 && b.length === 0) return true;

  // Custom comparison or default comparison
  if (compareFn) {
    // Check each item with custom comparison
    for (let i = 0; i < a.length; i++) {
      const matchFound = b.some((bItem) => compareFn(a[i], bItem));
      if (!matchFound) return false;
    }
    return true;
  }

  // Default stringified comparison
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useChangesSummary(): string {
  // Pull in everything you need from your stores
  const originalAssignment = useAuthorStore(
    (state) => state.originalAssignment,
  );
  const questions = useAuthorStore((state) => state.questions);
  const introduction = useAuthorStore((state) => state.introduction);
  const instructions = useAuthorStore((state) => state.instructions);
  const gradingCriteriaOverview = useAuthorStore(
    (state) => state.gradingCriteriaOverview,
  );

  // Config
  const {
    questionDisplay,
    questionVariationNumber,
    numAttempts,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
    displayOrder,
    strictTimeLimit,
    graded,
  } = useAssignmentConfig();

  // Feedback
  const {
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
  } = useAssignmentFeedbackConfig();

  const changesSummary = useMemo(() => {
    if (!originalAssignment) return "No changes detected.";

    const diffs: string[] = [];

    // -- Assignment-level fields --
    if (!safeCompare(introduction, originalAssignment.introduction))
      diffs.push("Modified introduction.");

    if (!safeCompare(instructions, originalAssignment.instructions))
      diffs.push("Changed instructions.");

    if (
      !safeCompare(
        gradingCriteriaOverview,
        originalAssignment.gradingCriteriaOverview,
      )
    )
      diffs.push("Updated grading criteria overview.");

    if (
      !safeCompare(
        showSubmissionFeedback,
        originalAssignment.showSubmissionFeedback,
      )
    )
      diffs.push("Changed submission feedback visibility.");

    if (!safeCompare(showQuestionScore, originalAssignment.showQuestionScore))
      diffs.push("Changed question score visibility.");

    if (
      !safeCompare(showAssignmentScore, originalAssignment.showAssignmentScore)
    )
      diffs.push("Changed assignment score visibility.");

    // -- Questions added/deleted --
    const originalQuestions = originalAssignment.questions || [];
    const currentQuestions = questions || [];

    // Added questions
    const addedQuestions = currentQuestions.filter(
      (question) =>
        !originalQuestions.some((origQ) => origQ.id === question?.id),
    );

    if (addedQuestions.length > 0) {
      diffs.push(`${addedQuestions.length} questions added.`);
    }

    // Deleted questions
    const deletedQuestions = originalQuestions.filter(
      (origQ) => !currentQuestions.some((q) => q?.id === origQ.id),
    );

    if (deletedQuestions.length > 0) {
      diffs.push(`${deletedQuestions.length} questions deleted.`);
    }

    // -- Matching questions, check modifications --
    currentQuestions.forEach((question) => {
      if (!question) return; // Skip if question is null/undefined

      const originalQuestion = originalQuestions.find(
        (orig) => orig?.id === question.id,
      );

      if (!originalQuestion) return; // This question was added

      // Compare question type
      if (
        !safeCompare(question.type, originalQuestion.type) &&
        question.type !== "EMPTY"
      ) {
        diffs.push(`Changed question type for question ${question.id}.`);
      }

      // Compare question text
      if (!safeCompare(question.question, originalQuestion.question)) {
        diffs.push(`Updated question text for question ${question.id}.`);
      }

      // Compare choices (handling potential null/undefined)
      if (!safeArrayCompare(question.choices, originalQuestion.choices)) {
        diffs.push(`Modified choices for question ${question.id}.`);
      }

      // Complex comparison for rubrics
      const compareRubrics = () => {
        const currentRubrics = question.scoring?.rubrics || [];
        const originalRubrics = originalQuestion.scoring?.rubrics || [];

        // Quick exit if both empty
        if (currentRubrics.length === 0 && originalRubrics.length === 0)
          return true;

        // Compare each rubric
        return currentRubrics.every((currentRubric, index) => {
          const origRubric = originalRubrics[index];

          // Compare rubric question
          if (
            !safeCompare(
              currentRubric.rubricQuestion,
              origRubric.rubricQuestion,
            )
          ) {
            console.log(
              "Rubric question mismatch",
              currentRubric.rubricQuestion,
              origRubric.rubricQuestion,
            );
            return false;
          }

          // Compare criteria
          const currentCriteria = currentRubric.criteria || [];
          const origCriteria = origRubric.criteria || [];

          if (currentCriteria.length !== origCriteria.length) return false;

          return currentCriteria.every((currentCrit, critIndex) => {
            const origCrit = origCriteria[critIndex];
            return (
              safeCompare(currentCrit.description, origCrit.description) &&
              safeCompare(currentCrit.points, origCrit.points)
            );
          });
        });
      };

      // Check scoring rubrics
      if (
        (question.scoring?.rubrics || []).length > 0 ||
        (originalQuestion.scoring?.rubrics || []).length > 0
      ) {
        if (!compareRubrics()) {
          diffs.push(`Updated scoring criteria for question ${question.id}.`);
        }
      }
      // compare "show rubric to learner" toggle

      if (
        !safeCompare(
          question.scoring?.showRubricsToLearner,
          originalQuestion.scoring?.showRubricsToLearner,
        )
      ) {
        diffs.push(
          `Changed "show rubric to learner" setting for question ${question.id}.`,
        );
      }
      // Compare randomized choices
      if (
        !safeCompare(
          question.randomizedChoices,
          originalQuestion.randomizedChoices,
        )
      ) {
        diffs.push(`Updated randomized choices for question ${question.id}.`);
      }

      // Compare response type
      if (!safeCompare(question.responseType, originalQuestion.responseType)) {
        diffs.push(`Changed response type for question ${question.id}.`);
      }

      // Compare word/character limits
      if (!safeCompare(question.maxWords, originalQuestion.maxWords)) {
        diffs.push(`Updated max words for question ${question.id}.`);
      }

      if (
        !safeCompare(question.maxCharacters, originalQuestion.maxCharacters)
      ) {
        diffs.push(`Updated max characters for question ${question.id}.`);
      }

      // Compare config objects
      if (
        !safeCompare(
          question.videoPresentationConfig,
          originalQuestion.videoPresentationConfig,
        ) &&
        (question.videoPresentationConfig ||
          originalQuestion.videoPresentationConfig)
      ) {
        diffs.push(
          `Updated video presentation config for question ${question.id}.`,
        );
      }

      if (
        !safeCompare(
          question.liveRecordingConfig,
          originalQuestion.liveRecordingConfig,
        ) &&
        (question.liveRecordingConfig || originalQuestion.liveRecordingConfig)
      ) {
        diffs.push(
          `Updated live recording config for question ${question.id}.`,
        );
      }

      // -- Variant comparison --
      const newVariants = question.variants || [];
      const origVariants = originalQuestion.variants || [];

      // Helper to get unique variant key
      const getVariantKey = (variant: QuestionVariants) =>
        variant.variantContent;

      // Added variants
      const addedVariants = newVariants.filter(
        (variant) =>
          !origVariants.some(
            (orig) => getVariantKey(orig) === getVariantKey(variant),
          ),
      );

      if (addedVariants.length > 0) {
        diffs.push(
          `Added ${addedVariants.length} variant(s) for question ${question.id}.`,
        );
      }

      // Deleted variants
      const deletedVariants = origVariants.filter(
        (orig) =>
          !newVariants.some(
            (variant) => getVariantKey(variant) === getVariantKey(orig),
          ),
      );

      if (deletedVariants.length > 0) {
        diffs.push(
          `Deleted ${deletedVariants.length} variant(s) for question ${question.id}.`,
        );
      }

      // For variants present in both
      newVariants.forEach((variant) => {
        if (!variant) return; // Skip if variant is null

        const matchingOrig = origVariants.find(
          (orig) => orig && getVariantKey(orig) === getVariantKey(variant),
        );

        if (matchingOrig) {
          // Compare randomized choices
          if (
            !safeCompare(
              variant.randomizedChoices,
              matchingOrig.randomizedChoices,
            )
          ) {
            diffs.push(
              `Modified randomized choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          // Compare choices
          if (
            !safeArrayCompare(
              variant.choices as Choice[],
              matchingOrig.choices as Choice[],
            )
          ) {
            diffs.push(
              `Modified choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          if (!safeCompare(variant.scoring, matchingOrig.scoring)) {
            diffs.push(
              `Modified scoring for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          // Compare max words
          if (!safeCompare(variant.maxWords, matchingOrig.maxWords)) {
            diffs.push(
              `Updated max words for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          // Compare max characters
          if (!safeCompare(variant.maxCharacters, matchingOrig.maxCharacters)) {
            diffs.push(
              `Updated max characters for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }
        }
      });
    });

    // -- Configuration fields --
    if (!safeCompare(questionDisplay, originalAssignment.questionDisplay)) {
      diffs.push("Changed question display type.");
    }

    if (!safeCompare(numAttempts, originalAssignment.numAttempts)) {
      diffs.push("Updated number of attempts.");
    }

    if (!safeCompare(passingGrade, originalAssignment.passingGrade)) {
      diffs.push("Modified passing grade.");
    }

    if (
      !safeCompare(timeEstimateMinutes, originalAssignment.timeEstimateMinutes)
    ) {
      diffs.push("Updated time estimate.");
    }

    if (
      !safeCompare(allotedTimeMinutes, originalAssignment.allotedTimeMinutes) &&
      allotedTimeMinutes
    ) {
      diffs.push(`Set alloted time to ${allotedTimeMinutes} minutes.`);
    }

    if (!safeCompare(displayOrder, originalAssignment.displayOrder)) {
      diffs.push("Modified question order.");
    }

    if (!safeCompare(graded, originalAssignment.graded)) {
      diffs.push(graded ? "Enabled grading." : "Disabled grading.");
    }
    console.log("diffs", diffs);
    return diffs.length > 0 ? diffs.join(" ") : "No changes detected.";
  }, [
    originalAssignment,
    questions,
    introduction,
    instructions,
    gradingCriteriaOverview,
    questionDisplay,
    questionVariationNumber,
    numAttempts,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
    displayOrder,
    strictTimeLimit,
    graded,
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
  ]);

  return changesSummary;
}
