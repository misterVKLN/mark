// src/llm/features/grading/interfaces/url-grading.interface.ts

import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";

export interface IUrlGradingService {
  /**
   * Grade a URL-based question response
   */
  gradeUrlBasedQuestion(
    model: UrlBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<UrlBasedQuestionResponseModel>;
}
