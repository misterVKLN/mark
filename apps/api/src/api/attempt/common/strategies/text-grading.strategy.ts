/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class TextGradingStrategy extends AbstractGradingStrategy<string> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
  }

  /**
   * Validate that the request contains a valid text response
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      !requestDto.learnerTextResponse ||
      requestDto.learnerTextResponse.trim() === ""
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedTextResponse",
          requestDto.language,
        ),
      );
    }

    // Validate against max words if specified
    if (question.maxWords && requestDto.learnerTextResponse) {
      const wordCount = requestDto.learnerTextResponse
        .trim()
        .split(/\s+/).length;
      if (wordCount > question.maxWords) {
        throw new BadRequestException(
          this.localizationService.getLocalizedString(
            "exceededMaxWords",
            requestDto.language,
            { maxWords: question.maxWords, currentWords: wordCount },
          ),
        );
      }
    }

    // Validate against max characters if specified
    if (question.maxCharacters && requestDto.learnerTextResponse) {
      const charCount = requestDto.learnerTextResponse.length;
      if (charCount > question.maxCharacters) {
        throw new BadRequestException(
          this.localizationService.getLocalizedString(
            "exceededMaxChars",
            requestDto.language,
            { maxChars: question.maxCharacters, currentChars: charCount },
          ),
        );
      }
    }

    return true;
  }

  /**
   * Extract the text response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    return requestDto.learnerTextResponse.trim();
  }

  /**
   * Grade the text response using LLM
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Create evaluation model for the LLM
    const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext,
      context.assignmentInstructions,
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.responseType ?? "OTHER",
    );

    // Use LLM to grade the response
    const gradingModel = await this.llmFacadeService.gradeTextBasedQuestion(
      textBasedQuestionEvaluateModel,
      context.assignmentId,
      context.language,
    );

    // Create and populate response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    return responseDto;
  }
}
