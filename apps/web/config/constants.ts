import { absoluteUrl } from "../lib/utils";
// API versioning support
export const API_VERSIONS = {
  V1: "v1",
  V2: "v2",
} as const;

export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

// Default to V1
let currentApiVersion: ApiVersion = API_VERSIONS.V2;

/**
 * Sets the API version to use for all requests
 * @param version The API version to use
 */
export function setApiVersion(version: ApiVersion): void {
  currentApiVersion = version;
}

/**
 * Gets the current API version
 * @returns The current API version
 */
export function getApiVersion(): ApiVersion {
  return currentApiVersion;
}

/**
 * Creates the base API path for the current version
 * @returns The base API path
 */
export function getBaseApiPath(overrideVersion?: ApiVersion): string {
  if (overrideVersion) {
    return absoluteUrl(`/api/${overrideVersion}`);
  }
  return absoluteUrl(`/api/${currentApiVersion}`);
}

/**
 * Creates the API routes for the current version
 * @returns The API routes object
 */
export function getApiRoutes() {
  const BASE_API_PATH = getBaseApiPath();

  return {
    // default
    user: `${BASE_API_PATH}/user-session`,
    info: `${BASE_API_PATH}/info`,
    assets: `${BASE_API_PATH}/assets`,
    // assignments
    assignments: `${BASE_API_PATH}/assignments`,
    // admin
    admin: `${BASE_API_PATH}/admin`,
    rubric: `${BASE_API_PATH}/assignments`,
    // reports
    reports: `${BASE_API_PATH}/reports`,
    // github
    github: `${BASE_API_PATH}/github`,
  };
}

// Constants for step sections in UI
export const stepTwoSections = {
  type: {
    title: "1. What type of assignment is this?",
    required: true,
  },
  time: {
    title: "2. How much time will learners have to complete this assignment?",
    required: false,
  },
  completion: {
    title: "3. How will learners complete the assignment?",
    required: true,
  },
  feedback: {
    title: "4. How much feedback should I give students?",
    description: "Choose what feedback Mark gives to students",
    required: true,
  },
  order: {
    title: "5. What order should questions appear in?",
    required: true,
  },
  questionDisplay: {
    title: "6. How should the questions be displayed?",
    required: false,
  },
} as const;
