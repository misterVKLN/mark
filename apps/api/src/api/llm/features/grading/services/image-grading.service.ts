// src/llm/features/grading/services/image-grading.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import { PROMPT_PROCESSOR, MODERATION_SERVICE } from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IImageGradingService } from "../interfaces/image-grading.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { ImageBasedQuestionEvaluateModel } from "src/api/llm/model/image.based.evalutate.model";
import { ImageBasedQuestionResponseModel } from "src/api/llm/model/image.based.response.model";

@Injectable()
export class ImageGradingService implements IImageGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ImageGradingService.name });
  }

  /**
   * Grade an image-based question response
   */
  async gradeImageBasedQuestion(
    imageBasedQuestionEvaluateModel: ImageBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<ImageBasedQuestionResponseModel> {
    const {
      question,
      imageData,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
    } = imageBasedQuestionEvaluateModel;

    // Validate the learner's response
    const validateLearnerResponse =
      await this.moderationService.validateContent(
        typeof learnerResponse === "string"
          ? learnerResponse
          : JSON.stringify(learnerResponse),
      );

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

    // Process the prompt with image through the LLM
    const formattedTextContent = `
    QUESTION:
    ${question}
    
    ASSIGNMENT INSTRUCTIONS:
    ${assignmentInstrctions ?? ""}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    ${JSON.stringify(previousQuestionsAnswersContext ?? [])}
    
    LEARNER RESPONSE:
    ${typeof learnerResponse === "string" ? learnerResponse : JSON.stringify(learnerResponse)}
    
    SCORING INFORMATION:
    Total Points Available: ${totalPoints}
    Scoring Type: ${scoringCriteriaType}
    Scoring Criteria: ${JSON.stringify(scoringCriteria)}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the learner's response to the image against the scoring criteria.
    2. Consider the relevance, accuracy, and completeness of the response.
    3. Award points based on how well the response meets the criteria.
    4. Provide detailed, constructive feedback that explains your evaluation.
    5. Include specific examples from the response when relevant.
    
    ${formatInstructions}
    `;

    try {
      const response = await this.promptProcessor.processPromptWithImage(
        new PromptTemplate({
          template: formattedTextContent,
          inputVariables: [],
        }),
        imageData,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
      );

      // Parse the response into the expected output format
      const imageBasedQuestionResponseModel = await parser.parse(response);
      return imageBasedQuestionResponseModel as ImageBasedQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error processing image grading: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to grade image-based question",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
