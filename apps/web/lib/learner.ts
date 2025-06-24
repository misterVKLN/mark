/**
 * API functions specific to learners
 */
import { toast } from "sonner";
import type {
  AssignmentAttemptWithQuestions,
  AssignmentFeedback,
  BaseBackendResponse,
  LiveRecordingData,
  QuestionAttemptRequest,
  QuestionAttemptRequestWithId,
  QuestionAttemptResponse,
  QuestionStore,
  RegradingRequest,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  SubmitAssignmentResponse,
} from "@config/types";
import { getApiRoutes } from "@/config/constants";

/**
 * Creates a attempt for a given assignment.
 * @param assignmentId The id of the assignment to create the attempt for.
 * @returns The id of the created attempt.
 * @throws An error if the request fails.
 */
export async function createAttempt(
  assignmentId: number,
  cookies?: string,
): Promise<number | undefined | "no more attempts"> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      if (res.status === 422) {
        return "no more attempts";
      }
      throw new Error(errorBody.message || "Failed to create attempt");
    }
    const { success, error, id } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * gets the questions for a given uncompleted attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
  language = "en",
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}?lang=${language}`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get attempt questions");
    }
    const attempt = (await res.json()) as AssignmentAttemptWithQuestions;
    return attempt;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * gets the questions for a given completed attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getCompletedAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/completed`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get attempt questions");
    }
    const attempt = (await res.json()) as AssignmentAttemptWithQuestions;
    return attempt;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Submits an answer for a given assignment, attempt, and question.
 */
export async function submitQuestion(
  assignmentId: number,
  attemptId: number,
  questionId: number,
  requestBody: QuestionAttemptRequest,
  cookies?: string,
): Promise<QuestionAttemptResponse | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/questions/${questionId}/responses`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      // remove empty fields
      body: JSON.stringify(requestBody, (key, value) => {
        if (value === "" || value === null || value === undefined) {
          return undefined;
        }
        return value as QuestionAttemptRequest;
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to submit question");
    }
    const data = (await res.json()) as QuestionAttemptResponse;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Get live recording feedback
 */
export async function getLiveRecordingFeedback(
  assignmentId: number,
  liveRecordingData: LiveRecordingData,
  cookies?: string,
): Promise<{ feedback: string }> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/live-recording-feedback`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      body: JSON.stringify({ liveRecordingData }), // wrap the data
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(
        errorBody.message || "Failed to fetch live recording feedback",
      );
    }

    const data = (await res.json()) as {
      feedback: string;
    };
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Submits an assignment for a given assignment and attempt.
 */
export async function submitAssignment(
  assignmentId: number,
  attemptId: number,
  responsesForQuestions: QuestionAttemptRequestWithId[],
  language?: string,
  authorQuestions?: QuestionStore[],
  authorAssignmentDetails?: ReplaceAssignmentRequest,
  cookies?: string,
): Promise<SubmitAssignmentResponse | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PATCH",
      body: JSON.stringify({
        submitted: true,
        responsesForQuestions,
        language,
        authorQuestions: authorQuestions || undefined,
        authorAssignmentDetails: authorAssignmentDetails || undefined,
      }),
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message);
    }
    const data = (await res.json()) as SubmitAssignmentResponse;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Get feedback for an assignment attempt
 */
export async function getFeedback(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentFeedback | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch feedback");
    }

    const data = (await res.json()) as AssignmentFeedback;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Submit feedback for an assignment attempt
 */
export async function submitFeedback(
  assignmentId: number,
  attemptId: number,
  feedback: AssignmentFeedback,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ feedback }),
    });

    if (!res.ok) {
      throw new Error("Failed to submit feedback");
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Submit a regrading request
 */
export async function submitRegradingRequest(
  regradingRequest: RegradingRequest,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${regradingRequest.assignmentId}/attempts/${regradingRequest.attemptId}/regrade`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ regradingRequest }),
    });

    if (!res.ok) {
      throw new Error("Failed to submit regrading request");
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Submit a report from a learner
 */
export async function submitReportLearner(
  assignmentId: number,
  attemptId: number,
  issueType: REPORT_TYPE,
  description: string,
  cookies?: string,
): Promise<{ success: boolean } | undefined> {
  try {
    const response:
      | Response
      | {
          status: number;
          message: string;
        } = await fetch(
      `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/report`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({
          issueType,
          description,
        }),
      },
    );

    if (response.status === 422) {
      throw new Error(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    } else if (!response.ok) {
      throw new Error("Failed to submit report");
    }

    return (await response.json()) as { success: boolean };
  } catch (error: unknown) {
    if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to submit report");
    }
  }
}
