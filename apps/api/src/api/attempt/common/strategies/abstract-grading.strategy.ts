/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";

import { LocalizationService } from "../../common/utils/localization.service";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { IGradingStrategy } from "../interfaces/grading-strategy.interface";

@Injectable()
export abstract class AbstractGradingStrategy<T = any>
  implements IGradingStrategy<T>
{
  constructor(
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService?: GradingAuditService,
  ) {}

  /**
   * Process a question response from start to finish
   * @param question The question to grade
   * @param requestDto The student's response
   * @param context Additional context for grading
   * @returns The graded response
   */
  async handleResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: T;
  }> {
    try {
      // Step 1: Validate the response
      await this.validateResponse(question, requestDto);

      // Step 2: Extract the learner's response
      const learnerResponse = await this.extractLearnerResponse(requestDto);

      // Step 3: Grade the response
      const responseDto = await this.gradeResponse(
        question,
        learnerResponse,
        context,
      );

      // Step 4: Record the grading for audit purposes (if audit service is available)
      if (this.gradingAuditService) {
        await this.gradingAuditService.recordGrading({
          questionId: question.id,
          assignmentId: context.assignmentId,
          requestDto,
          responseDto,
          gradingStrategy: this.constructor.name,
          metadata: context.metadata,
        });
      }

      return { responseDto, learnerResponse };
    } catch (error) {
      // Log and rethrow the error
      console.error(`Error in ${this.constructor.name}:`, error);
      throw error;
    }
  }

  /**
   * Default implementation of validateResponse - should be overridden by subclasses
   */
  abstract validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean>;

  /**
   * Default implementation of extractLearnerResponse - should be overridden by subclasses
   */
  abstract extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<T>;

  /**
   * Default implementation of gradeResponse - should be overridden by subclasses
   */
  abstract gradeResponse(
    question: QuestionDto,
    learnerResponse: T,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto>;

  /**
   * Create a response DTO with an error message
   */
  protected createErrorResponse(
    errorMessage: string,
    language?: string,
  ): CreateQuestionResponseAttemptResponseDto {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = 0;

    const feedback = new GeneralFeedbackDto();
    feedback.feedback = this.localizationService.getLocalizedString(
      errorMessage,
      language,
    );

    responseDto.feedback = [feedback];
    return responseDto;
  }

  /**
   * Helper function to create a correctly formatted response DTO
   */
  protected createResponseDto(
    points: number,
    feedbackItems: Array<GeneralFeedbackDto | Record<string, any>>,
  ): CreateQuestionResponseAttemptResponseDto {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = points;
    responseDto.feedback = feedbackItems as GeneralFeedbackDto[];
    return responseDto;
  }

  /**
   * Parse a JSON field from a database record safely
   */
  protected parseJsonField(field: any): any {
    if (!field) return null;

    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch (error) {
        console.error("Error parsing JSON field:", error);
        return null;
      }
    }

    return field;
  }
}
