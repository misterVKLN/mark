// src/llm/features/grading/services/text-grading.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import {
  PROMPT_PROCESSOR,
  MODERATION_SERVICE,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { ITextGradingService } from "../interfaces/text-grading.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "src/api/llm/model/text.based.question.response.model";

@Injectable()
export class TextGradingService implements ITextGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: TextGradingService.name });
  }

  /**
   * Grade a text-based question response
   */
  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<TextBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
    } = textBasedQuestionEvaluateModel;

    // Validate the learner's response
    const validateLearnerResponse =
      await this.moderationService.validateContent(learnerResponse);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Define output schema
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number().describe("Points awarded based on the criteria"),
        feedback: z
          .string()
          .describe(
            "Feedback for the learner based on their response to the criteria",
          ),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Add response-specific instructions based on the type
    const responseSpecificInstruction =
      (RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS[responseType] as
        | string
        | undefined) ?? "";

    // Load the grading template
    const template = await this.loadTextGradingTemplate();

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        assignment_instructions: () => assignmentInstrctions ?? "",
        responseSpecificInstruction: () => responseSpecificInstruction,
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext ?? []),
        learner_response: () => learnerResponse,
        total_points: () => totalPoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType,
        language: () => language ?? "en",
      },
    });

    // Process the prompt through the LLM
    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    try {
      // Parse the response into the expected output format
      const textBasedQuestionResponseModel = await parser.parse(response);
      return textBasedQuestionResponseModel as TextBasedQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing LLM response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to parse grading response",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Load the text grading template
   * In a real implementation, this would load from a template file
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async loadTextGradingTemplate(): Promise<string> {
    // In a real implementation, this would load from a file in the templates directory
    return `
    You are an expert educator evaluating a student's response to a question.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    STUDENT'S RESPONSE:
    {learner_response}
    
    RESPONSE TYPE SPECIFIC INSTRUCTIONS:
    {responseSpecificInstruction}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the student's response against the scoring criteria.
    2. Award points based on how well the response meets the criteria.
    3. Provide detailed feedback that explains the points awarded and offers guidance for improvement.
    4. Be fair and consistent in your evaluation.
    5. Ensure your feedback is constructive, specific, and actionable.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }
}
