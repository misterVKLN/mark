import { QuestionType, ResponseType } from "@prisma/client";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

/**
 * Model that holds data for evaluating an image-based question.
 */
export class ImageBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  /**
   * Image response from learner. Each image is base64 encoded with metadata.
   */
  public learnerImageResponse: {
    imageUrl: string;
    filename: string;
    mimeType: string;
    imageAnalysisResult: ImageAnalysisResult;
    imageData: string; // base64 encoded image data
  }[];
  question: string;
  totalPoints: number;
  scoringCriteriaType: string;
  scoringCriteria: object;
  questionType: QuestionType;
  responseType: ResponseType;
  imageData: string;
  learnerResponse: string;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    learnerImageResponse: {
      imageUrl: string;
      filename: string;
      mimeType: string;
      imageAnalysisResult: ImageAnalysisResult;
      imageData: string; // base64 encoded image data
    }[],
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: object,
    questionType: QuestionType = QuestionType.UPLOAD,
    responseType: ResponseType = ResponseType.OTHER,
    imageData: string,
    learnerResponse: string,
  ) {
    this.question = question;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
    this.learnerImageResponse = learnerImageResponse;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
    this.questionType = questionType;
    this.responseType = responseType;
    this.imageData = imageData;
    this.learnerResponse = learnerResponse;
  }
  previousQuestionsAnswersContext: QuestionAnswerContext[];
  assignmentInstrctions: string;
}

/**
 * Represents the result of analyzing an image, which can be provided
 * to the LLM for grading assistance.
 */
export interface ImageAnalysisResult {
  // Basic image properties
  width: number;
  height: number;
  aspectRatio: number;
  fileSize: number; // in bytes

  // Visual properties
  dominantColors?: string[]; // Hex codes of dominant colors
  brightness?: number; // Average brightness value
  contrast?: number; // Contrast measure
  sharpness?: number; // Sharpness/blur detection

  // Content detection (from image analysis API)
  detectedObjects?: {
    label: string;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];

  // Text detection if any text is present in the image
  detectedText?: {
    text: string;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];

  // Technical quality assessment
  technicalQuality?: {
    exposureScore?: number; // 0-100
    noiseLevel?: number; // 0-100
    compositionScore?: number; // 0-100
  };

  // Scene analysis
  sceneType?: string; // e.g., "landscape", "portrait", "indoor", "macro"

  // Raw description from image analysis
  rawDescription?: string;

  // Optional field for any additional analysis data
  additionalData?: Record<string, any>;
}
