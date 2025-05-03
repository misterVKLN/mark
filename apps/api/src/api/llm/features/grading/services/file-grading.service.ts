// src/llm/features/grading/services/file-grading.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import { PROMPT_PROCESSOR, MODERATION_SERVICE } from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IFileGradingService } from "../interfaces/file-grading.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ResponseType } from "@prisma/client";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "src/api/llm/model/file.based.question.response.model";
import { Logger } from "winston";

@Injectable()
export class FileGradingService implements IFileGradingService {
  private readonly logger: Logger;
  private readonly templateMap: Record<ResponseType, string> = {
    CODE: this.loadCodeFileTemplate(),
    REPO: this.loadRepoTemplate(),
    ESSAY: this.loadEssayFileTemplate(),
    REPORT: this.loadReportFileTemplate(),
    PRESENTATION: this.loadPresentationFileTemplate(),
    VIDEO: this.loadVideoFileTemplate(),
    AUDIO: this.loadAudioFileTemplate(),
    SPREADSHEET: this.loadSpreadsheetFileTemplate(),
    LIVE_RECORDING: this.loadVideoFileTemplate(), // Reusing video template
    OTHER: this.loadDocumentFileTemplate(),
  };

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: FileGradingService.name });
  }

  /**
   * Grade a file-based question response
   */
  async gradeFileBasedQuestion(
    fileBasedQuestionEvaluateModel: FileUploadQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<FileBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      responseType,
    } = fileBasedQuestionEvaluateModel;

    // Validate the learner's response
    const validateLearnerResponse =
      await this.moderationService.validateContent(
        learnerResponse.map((item) => item.content).join(" "),
      );

    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Calculate actual max points from the rubrics if available
    let maxTotalPoints = totalPoints;
    if (
      scoringCriteria &&
      typeof scoringCriteria === "object" &&
      scoringCriteria.rubrics
    ) {
      const rubrics = scoringCriteria.rubrics;
      if (Array.isArray(rubrics)) {
        let sum = 0;
        for (const rubric of rubrics) {
          if (Array.isArray(rubric.criteria)) {
            const maxCriteriaPoints = Math.max(
              ...rubric.criteria.map((criterion) => criterion.points || 0),
            );
            sum += maxCriteriaPoints;
          }
        }
        maxTotalPoints = sum;
      }
    }

    // Select the appropriate template based on responseType
    const selectedTemplate =
      this.templateMap[responseType] || this.templateMap.OTHER;

    // Define output schema
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number().describe("Points awarded based on the criteria"),
        feedback: z
          .string()
          .describe(
            "Feedback for the learner based on their response to the criteria, including any suggestions for improvement and detailed explanation why you chose to provide the points you did",
          ),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: selectedTemplate,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        files: () =>
          JSON.stringify(
            learnerResponse.map((item) => ({
              filename: item.filename,
              content: item.content,
            })),
          ),
        total_points: () => maxTotalPoints.toString(), // Using calculated max points
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        grading_type: () => responseType,
        language: () => language ?? "en",
        format_instructions: () => formatInstructions,
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
      const fileBasedQuestionResponseModel = await parser.parse(response);

      // Validate that points don't exceed the maximum
      const parsedPoints = fileBasedQuestionResponseModel.points;
      if (parsedPoints > maxTotalPoints) {
        this.logger.warn(
          `LLM awarded ${parsedPoints} points, which exceeds maximum of ${maxTotalPoints}. Capping at maximum.`,
        );
        fileBasedQuestionResponseModel.points = maxTotalPoints;
      } else if (parsedPoints < 0) {
        this.logger.warn(
          `LLM awarded negative points (${parsedPoints}). Setting to 0.`,
        );
        fileBasedQuestionResponseModel.points = 0;
      }

      return fileBasedQuestionResponseModel as FileBasedQuestionResponseModel;
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

  // Template methods
  private loadCodeFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's code submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the code files against the scoring criteria.
    2. Assess code functionality, efficiency, style, and best practices.
    3. Award points based on how well the submission meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific code examples from the submission in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadRepoTemplate(): string {
    return `
    You are an expert educator evaluating a student's repository submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the repository files against the scoring criteria.
    2. Assess code structure, documentation, testing, and adherence to best practices.
    3. Award points based on how well the repository meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the repository in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadEssayFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's essay submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the essay against the scoring criteria.
    2. Assess thesis, argumentation, evidence, structure, and writing quality.
    3. Award points based on how well the essay meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the essay in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadReportFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's report submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the report against the scoring criteria.
    2. Assess data presentation, analysis, conclusions, format, and writing quality.
    3. Award points based on how well the report meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the report in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadPresentationFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's presentation submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the presentation against the scoring criteria.
    2. Assess content quality, slide design, organization, and visual communication.
    3. Award points based on how well the presentation meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the presentation in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadVideoFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's video submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the video content against the scoring criteria.
    2. If a transcript is provided, assess the content, delivery, and quality.
    3. Award points based on how well the submission meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadAudioFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's audio submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the audio content against the scoring criteria.
    2. If a transcript is provided, assess the content, delivery, and quality.
    3. Award points based on how well the submission meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadSpreadsheetFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's spreadsheet submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the spreadsheet against the scoring criteria.
    2. Assess data organization, formula usage, analysis, and presentation.
    3. Award points based on how well the spreadsheet meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the spreadsheet in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  private loadDocumentFileTemplate(): string {
    return `
    You are an expert educator evaluating a student's document submission.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the document against the scoring criteria.
    2. Assess content, organization, completeness, and quality.
    3. Award points based on how well the document meets the criteria, ensuring you never award more than the maximum points available for each criterion.
    4. For each rubric criterion, award points up to the maximum specified for that criterion.
    5. Provide detailed, constructive feedback that explains your evaluation.
    6. Include specific examples from the document in your feedback when relevant.
    7. Suggest improvements for any issues identified.
    8. The total points you award must not exceed {total_points}.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }
}
