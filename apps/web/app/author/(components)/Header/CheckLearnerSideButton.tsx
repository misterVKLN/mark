"use client";

import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import Tooltip from "@/components/Tooltip";
import { QuestionAuthorStore } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import { EyeIcon } from "@heroicons/react/24/solid";
import type { ComponentPropsWithoutRef, FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  disabled?: boolean;
}

const CheckLearnerSideButton: FC<Props> = (props) => {
  const { disabled } = props;
  const questions = useAuthorStore((state) => state.questions);
  const assignmentId = useAuthorStore((state) => state.activeAssignmentId);
  const assignmentConfigstate = useAssignmentConfig.getState();
  const authorState = useAuthorStore.getState();

  const assignmentConfig = {
    questionDisplay: assignmentConfigstate.questionDisplay,
    graded: assignmentConfigstate.graded,
    numAttempts: assignmentConfigstate.numAttempts,
    passingGrade: assignmentConfigstate.passingGrade,
    allotedTimeMinutes: assignmentConfigstate.allotedTimeMinutes,
    timeEstimateMinutes: assignmentConfigstate.timeEstimateMinutes,
    displayOrder: assignmentConfigstate.displayOrder,
    strictTimeLimit: assignmentConfigstate.strictTimeLimit,
    introduction: authorState.introduction ?? "",
    instructions: authorState.instructions ?? "",
    gradingCriteriaOverview: authorState.gradingCriteriaOverview ?? "",
    name: authorState.name,
    id: assignmentId,
  };

  function handleJumpToLearnerSide(
    questions: QuestionAuthorStore[],
    assignmentId: number,
  ) {
    const processedQuestions = processQuestions(questions);
    localStorage.setItem("questions", JSON.stringify(processedQuestions));
    localStorage.setItem("assignmentConfig", JSON.stringify(assignmentConfig));
    window.open(`/learner/${assignmentId}?authorMode=true`, "_blank");
  }

  return (
    <Tooltip
      content={
        disabled
          ? "Please complete setup before previewing the learner side"
          : "Preview the learner side"
      }
      distance={-2.5}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => handleJumpToLearnerSide(questions, assignmentId)}
        className="text-sm flex items-center justify-center px-3 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 text-violet-800 border-violet-100 bg-violet-50 hover:bg-violet-100 dark:text-violet-100 dark:border-violet-800 dark:bg-violet-900 dark:hover:bg-violet-950 disabled:opacity-50"
      >
        <EyeIcon className="w-5 h-5" />
        <span className="ml-2">Preview</span>
      </button>
    </Tooltip>
  );
};

export default CheckLearnerSideButton;
