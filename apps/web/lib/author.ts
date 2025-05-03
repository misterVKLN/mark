/**
 * API functions specific to assignment authors
 */
import { getApiRoutes } from "@/config/constants";
import type {
  AssignmentAttempt,
  BaseBackendResponse,
  Choice,
  CreateQuestionRequest,
  PublishJobResponse,
  Question,
  QuestionAuthorStore,
  QuestionGenerationPayload,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  Scoring,
} from "@config/types";

/**
 * Calls the backend to modify an assignment.
 */
export async function replaceAssignment(
  data: ReplaceAssignmentRequest,
  id: number,
  cookies?: string,
): Promise<boolean> {
  try {
    const res = await fetch(getApiRoutes().assignments + `/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to replace assignment");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Calls the backend to update an assignment.
 */
export async function updateAssignment(
  data: Partial<ReplaceAssignmentRequest>,
  id: number,
  cookies?: string,
): Promise<boolean> {
  try {
    const res = await fetch(getApiRoutes().assignments + `/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to update assignment");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Creates a question for a given assignment.
 * @param assignmentId The id of the assignment to create the question for.
 * @param question The question to create.
 * @returns The id of the created question.
 * @throws An error if the request fails.
 */
export async function createQuestion(
  assignmentId: number,
  question: CreateQuestionRequest,
  cookies?: string,
): Promise<number | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(question),
    });

    if (!res.ok) {
      throw new Error("Failed to create question");
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
 * Subscribes to job status updates.
 */
export function subscribeToJobStatus(
  jobId: number,
  onProgress?: (percentage: number, progressText?: string) => void,
  setQuestions?: (questions: Question[]) => void,
): Promise<[boolean, Question[]]> {
  return new Promise<[boolean, Question[]]>((resolve, reject) => {
    let eventSource: EventSource | null = null;
    let timeoutId: NodeJS.Timeout;
    let isResolved = false;
    const controller = new AbortController();
    let receivedQuestions: Question[] = [];

    const cleanUp = () => {
      controller.abort();
      eventSource?.close();
      clearTimeout(timeoutId);
      eventSource = null;
    };

    const handleCompletion = (success: boolean) => {
      if (!isResolved) {
        isResolved = true;
        cleanUp();
        resolve([success, receivedQuestions]);
      }
    };

    const handleError = (error: string) => {
      if (!isResolved) {
        isResolved = true;
        cleanUp();
        reject(new Error(error));
      }
    };

    // Initial connection timeout (30 seconds)
    timeoutId = setTimeout(() => handleError("Connection timeout"), 30000);

    try {
      eventSource = new EventSource(
        `${
          getApiRoutes().assignments
        }/jobs/${jobId}/status-stream?_=${Date.now()}`,
        { withCredentials: true },
      );

      // Abort the connection when the controller signal is aborted
      controller.signal.addEventListener("abort", () => {
        eventSource?.close();
      });

      eventSource.onopen = () => {
        console.log("SSE connection established");
        clearTimeout(timeoutId);
        // Set job processing timeout (e.g. 5 minutes)
        timeoutId = setTimeout(
          () => handleError("Job processing timeout"),
          300000,
        );
      };

      // Listen for "update" events
      eventSource.addEventListener("update", (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as PublishJobResponse;
          // Report progress updates if available
          if (data.percentage !== undefined && onProgress) {
            onProgress(data.percentage, data.progress);
          }
          // Update questions if present
          if (data?.result) {
            receivedQuestions = JSON.parse(
              data.result,
            ) as QuestionAuthorStore[];
            if (setQuestions) {
              console.log("Received questions:", receivedQuestions);
              setQuestions(receivedQuestions);
            }
          }
          if (data.done) {
            clearTimeout(timeoutId);
            handleCompletion(data.status === "Completed");
          } else if (data.status === "Failed") {
            handleError(data.progress || "Job failed");
          }
        } catch (parseError) {
          handleError("Invalid server response");
        }
      });

      // Listen for "finalize" events
      eventSource.addEventListener(
        "finalize",
        (event: MessageEvent<string>) => {
          try {
            const data = JSON.parse(event.data) as PublishJobResponse;
            if (data.percentage !== undefined && onProgress) {
              onProgress(data.percentage, data.progress);
            }
            console.log("Final finalize:", data);
            if (data?.result) {
              receivedQuestions = JSON.parse(
                data.result,
              ) as QuestionAuthorStore[];
              if (setQuestions) {
                console.log("Received questions:", receivedQuestions);
                setQuestions(receivedQuestions);
              }
            }
            handleCompletion(data.status === "Completed");
          } catch {
            handleError("Invalid finalize event response");
          }
        },
      );

      // Optional: Listen for "close" events
      eventSource.addEventListener("close", (event: MessageEvent<string>) => {
        console.log("SSE close event:", event.data);
      });

      eventSource.onerror = (err) => {
        console.error("SSE error:", err);
        if (!isResolved) {
          if (eventSource?.readyState === EventSource.CLOSED) {
            handleError("Connection closed unexpectedly");
          } else {
            setTimeout(() => {
              if (!isResolved) handleError("Connection error");
            }, 2000);
          }
        }
      };
    } catch (error) {
      handleError("Failed to establish SSE connection");
    }
  });
}

/**
 * Publishes an assignment.
 */
export async function publishAssignment(
  assignmentId: number,
  updatedAssignment: ReplaceAssignmentRequest,
  cookies?: string,
): Promise<{ jobId: number; message: string } | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/publish`;

  const payload = {
    ...updatedAssignment,
  };
  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to start publishing job");
    }

    // Response should now contain jobId instead of questions
    const { jobId, message } = (await res.json()) as {
      jobId: number;
      message: string;
    };
    return { jobId, message };
  } catch (err) {
    console.error("Error starting publishing job:", err);
  }
}

/**
 * Updates a question for a given assignment.
 * @param assignmentId The id of the assignment to update the question for.
 * @param questionId The id of the question to update.
 * @param question The question to update.
 * @returns The id of the updated question.
 * @throws An error if the request fails.
 */
export async function replaceQuestion(
  assignmentId: number,
  questionId: number,
  question: CreateQuestionRequest,
  cookies?: string,
): Promise<number | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(question),
    });

    if (!res.ok) {
      throw new Error("Failed to update question");
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
 * Generates a variant of questions.
 */
export async function generateQuestionVariant(
  questionsFromFrontend: QuestionAuthorStore[],
  questionVariationNumber: number,
  assignmentId: number,
  cookies?: string,
): Promise<QuestionAuthorStore[] | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/question/generate-variant`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({
        questions: questionsFromFrontend,
        questionVariationNumber,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(
        errorBody.message || "Failed to generate question variant",
      );
    }
    const { success, error, questions } =
      (await res.json()) as BaseBackendResponse & {
        questions: QuestionAuthorStore[];
      };

    if (!success) {
      throw new Error(error);
    }

    return questions;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Generates a rubric for a question.
 */
export async function generateRubric(
  question: QuestionAuthorStore,
  assignmentId: number,
  rubricIndex?: number,
  cookies?: string,
): Promise<Scoring | Choice[]> {
  const endpointURL = `${getApiRoutes().rubric}/${assignmentId}/questions/create-marking-rubric`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ question, rubricIndex }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to generate rubric");
    }
    const rubric = (await res.json()) as Scoring | Choice[];
    return rubric;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Expands a marking rubric.
 */
export async function expandMarkingRubric(
  question: QuestionAuthorStore,
  assignmentId: number,
  cookies?: string,
): Promise<QuestionAuthorStore> {
  const endpointURL = `${getApiRoutes().rubric}/${assignmentId}/questions/expand-marking-rubric`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to generate rubric");
    }
    const rubric = (await res.json()) as QuestionAuthorStore;
    return rubric;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Deletes a question for a given assignment.
 */
export async function deleteQuestion(
  assignmentId: number,
  questionId: number,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to delete question");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Get a list of attempts for a given assignment (for authors).
 */
export async function getAttempts(
  assignmentId: number,
  cookies?: string,
): Promise<AssignmentAttempt[] | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch attempts");
    }
    const attempts = (await res.json()) as AssignmentAttempt[];
    return attempts;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Upload files and generate questions based on them.
 */
export async function uploadFiles(
  payload: QuestionGenerationPayload,
  cookies?: string,
): Promise<{ success: boolean; jobId?: number }> {
  const endpointURL = `${getApiRoutes().assignments}/${payload.assignmentId}/generate-questions`;
  const TIMEOUT = 1000000;

  try {
    const res = (await Promise.race([
      fetch(endpointURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "keep-alive",
          KeepAlive: "timeout=1000000",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({ ...payload }),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), TIMEOUT),
      ),
    ])) as Response;

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to upload files");
    }

    const data = (await res.json()) as {
      success: boolean;
      jobId?: number;
    };

    if (data.jobId) {
      return {
        success: true,
        jobId: data.jobId,
      };
    } else {
      return { success: false };
    }
  } catch (err) {
    console.error("Error uploading files:", err);
    return { success: false };
  }
}

/**
 * Fetches the status of a job by its ID.
 */
export async function getJobStatus(
  jobId: number,
  cookies?: string,
): Promise<
  | {
      status: string;
      progress: string;
      progressPercentage: string;
      questions?: QuestionAuthorStore[];
    }
  | undefined
> {
  const endpointURL = `${getApiRoutes().assignments}/jobs/${jobId}/status`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch job status");
    }

    const data = (await res.json()) as {
      status: string;
      progress: string;
      progressPercentage: string;
      questions?: QuestionAuthorStore[];
    };
    return data;
  } catch (err) {
    console.error("Error fetching job status:", err);
    return undefined;
  }
}

/**
 * Submit report from an author
 */
export async function submitReportAuthor(
  assignmentId: number,
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
      `${getApiRoutes().assignments}/${assignmentId}/report`,
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
      throw error;
    } else {
      throw new Error("Failed to submit report");
    }
  }
}
