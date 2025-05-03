/**
 * Shared API functions that can be used by both learners and authors
 */
import { getApiRoutes } from "@/config/constants";
import type {
  Assignment,
  BaseBackendResponse,
  Choice,
  GetAssignmentResponse,
  QuestionStore,
  User,
} from "@config/types";
import { absoluteUrl } from "./utils";

// Create a v1-specific route for user
const V1_USER_ROUTE = absoluteUrl("/api/v1/user-session");

export async function getUser(cookies?: string): Promise<User | undefined> {
  try {
    // Use the v1 route directly instead of getApiRoutes()
    const res = await fetch(V1_USER_ROUTE, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch user");
    }

    return (await res.json()) as User;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Calls the backend to get an assignment.
 * @param id The id of the assignment to get.
 * @returns The assignment if it exists, undefined otherwise.
 * @throws An error if the request fails.
 * @throws An error if the assignment does not exist.
 * @throws An error if the user is not authorized to view the assignment.
 */
export async function getAssignment(
  id: number,
  userPreferedLanguage?: string,
  cookies?: string,
): Promise<Assignment> {
  try {
    const url = userPreferedLanguage
      ? `${getApiRoutes().assignments}/${id}?lang=${userPreferedLanguage}`
      : `${getApiRoutes().assignments}/${id}`;

    const res = await fetch(url, {
      headers: {
        "Cache-Control": "no-cache",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    const responseBody = (await res.json()) as GetAssignmentResponse &
      BaseBackendResponse;

    if (!res.ok) {
      throw new Error(
        responseBody.message || `Request failed with status ${res.status}`,
      );
    }

    const { success, ...remainingData } = responseBody;

    return remainingData as Assignment;
  } catch (err) {
    console.error("Error fetching assignment:", err);
    throw err;
  }
}

/**
 * Calls the backend to get all assignments.
 * @returns An array of assignments.
 */
export async function getAssignments(
  cookies?: string,
): Promise<Assignment[] | undefined> {
  try {
    const res = await fetch(getApiRoutes().assignments, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch assignments");
    }
    const assignments = (await res.json()) as Assignment[];
    return assignments;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Fetches the supported languages for an assignment.
 * @param assignmentId The ID of the assignment.
 * @returns An array of supported language codes.
 * @throws An error if the request fails.
 */
export async function getSupportedLanguages(
  assignmentId: number,
): Promise<string[]> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/languages`;

  try {
    const res = await fetch(endpointURL);

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch languages");
    }

    const data = (await res.json()) as { languages: string[] };
    if (!data.languages) {
      throw new Error("Failed to fetch languages");
    }
    return data.languages || [];
  } catch (err) {
    console.error("Error fetching languages:", err);
    return ["en"]; // Default fallback to English if API fails
  }
}

/**
 * Translates a question to a different language.
 */
export async function translateQuestion(
  assignmentId: number,
  questionId: number,
  question: QuestionStore,
  selectedLanguage: string,
  selectedLanguageCode: string,
  cookies?: string,
): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}/translations`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({
        selectedLanguage,
        selectedLanguageCode,
        question,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to translate question");
    }

    return (await res.json()) as {
      translatedQuestion: string;
      translatedChoices?: Choice[];
    };
  } catch (err) {
    console.error(err);
    throw err; // Ensure errors are handled appropriately in the UI
  }
}
