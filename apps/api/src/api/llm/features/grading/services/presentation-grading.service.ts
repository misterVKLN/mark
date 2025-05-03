/* eslint-disable unicorn/no-null */
// src/llm/features/grading/services/presentation-grading.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import { PROMPT_PROCESSOR, MODERATION_SERVICE } from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPresentationGradingService } from "../interfaces/presentation-grading.interface";
import { LearnerLiveRecordingFeedback } from "../../../../assignment/attempt/dto/assignment-attempt/types";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PresentationQuestionEvaluateModel } from "src/api/llm/model/presentation.question.evaluate.model";
import { PresentationQuestionResponseModel } from "src/api/llm/model/presentation.question.response.model";
import { Logger } from "winston";

@Injectable()
export class PresentationGradingService implements IPresentationGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: PresentationGradingService.name,
    });
  }

  /**
   * Grade a presentation question response
   */
  async gradePresentationQuestion(
    presentationQuestionEvaluateModel: PresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<PresentationQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
    } = presentationQuestionEvaluateModel;

    // Basic guard: ensure question text is present
    if (!question) {
      throw new HttpException("Missing question data", HttpStatus.BAD_REQUEST);
    }

    // If your guard rails only apply to the transcript, ensure it's at least a string
    const hasTranscript =
      learnerResponse?.transcript &&
      typeof learnerResponse.transcript === "string";
    const validateLearnerResponse = hasTranscript
      ? await this.moderationService.validateContent(learnerResponse.transcript)
      : true; // If no transcript is given, you can skip or apply different rules

    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Optional fields: Provide fallbacks if missing
    const safeSpeechReport =
      learnerResponse?.speechReport ?? "No speech analysis provided.";
    const safeContentReport =
      learnerResponse?.contentReport ?? "No content analysis provided.";
    const safeBodyLangScore =
      learnerResponse?.bodyLanguageScore == null
        ? "N/A"
        : learnerResponse.bodyLanguageScore.toString();
    const safeBodyLangExplanation =
      learnerResponse?.bodyLanguageExplanation ?? "Not provided.";

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

    // Build the prompt with partial variables, safely handling missing fields
    const prompt = new PromptTemplate({
      template: this.loadPresentationGradingTemplate(),
      inputVariables: [],
      partialVariables: {
        question: () => question, // The main question text
        assignment_instructions: () =>
          assignmentInstrctions ?? "No assignment instructions provided.",
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext ?? []),
        transcript: () =>
          learnerResponse?.transcript ?? "No transcript provided.",
        contentReport: () => safeContentReport,
        speechReport: () => safeSpeechReport,
        bodyLanguageScore: () => safeBodyLangScore,
        bodyLanguageExplanation: () => safeBodyLangExplanation,
        total_points: () =>
          totalPoints == null ? "0" : totalPoints.toString(),
        scoring_type: () => scoringCriteriaType ?? "N/A",
        scoring_criteria: () => JSON.stringify(scoringCriteria ?? {}),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType ?? "N/A",
      },
    });

    // Process the prompt through the LLM
    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    try {
      // Parse the LLM output to get points & feedback
      const presentationQuestionResponseModel = await parser.parse(response);
      return presentationQuestionResponseModel as PresentationQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing presentation grading response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to parse grading response",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Generate feedback for a live recording
   */
  async getLiveRecordingFeedback(
    liveRecordingData: LearnerLiveRecordingFeedback,
    assignmentId: number,
  ): Promise<string> {
    // Define the parser
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        feedback: z.string().nonempty("Feedback cannot be empty"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Safely handle optional fields using defaults when missing
    const safeSpeechReport =
      liveRecordingData.speechReport ?? "No speech analysis available.";
    const safeContentReport =
      liveRecordingData.contentReport ?? "No content analysis available.";
    const safeBodyLangScore =
      liveRecordingData.bodyLanguageScore == null
        ? "N/A"
        : String(liveRecordingData.bodyLanguageScore);
    const safeBodyLangExplanation =
      liveRecordingData.bodyLanguageExplanation ?? "Not provided.";

    const prompt = new PromptTemplate({
      template: this.loadLiveRecordingFeedbackTemplate(),
      inputVariables: [],
      partialVariables: {
        question_text: () => liveRecordingData.question.question,

        live_recording_transcript: () =>
          JSON.stringify(
            liveRecordingData.transcript ?? "No transcript provided.",
            null,
            2,
          ),

        live_recording_speechReport: () =>
          JSON.stringify(safeSpeechReport, null, 2),

        live_recording_contentReport: () =>
          JSON.stringify(safeContentReport, null, 2),

        live_recording_bodyLanguageScore: () => String(safeBodyLangScore),

        live_recording_bodyLanguageExplanation: () => safeBodyLangExplanation,

        format_instructions: () => formatInstructions,
      },
    });

    try {
      // Process the prompt through the LLM
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.LIVE_RECORDING_FEEDBACK,
      );

      // Parse the response
      const parsedResponse = await parser.parse(response);
      return parsedResponse.feedback;
    } catch (error) {
      this.logger.error(
        `Error generating live recording feedback: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to generate live recording feedback",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Load the presentation grading template
   */
  private loadPresentationGradingTemplate(): string {
    return `
    You are an expert educator evaluating a student's presentation or live recording.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    PRESENTATION DATA:
    Transcript: {transcript}
    Content Report: {contentReport}
    Speech Report: {speechReport}
    Body Language Score: {bodyLanguageScore}
    Body Language Explanation: {bodyLanguageExplanation}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the presentation/recording against the scoring criteria.
    2. Consider content quality, delivery, body language, and overall effectiveness.
    3. Award points based on how well the presentation meets the criteria.
    4. Provide detailed, constructive feedback that explains your evaluation.
    5. Include specific examples from the transcript when relevant.
    6. Suggest improvements for future presentations.
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  /**
   * Load the live recording feedback template
   */
  private loadLiveRecordingFeedbackTemplate(): string {
    return `
    You are an expert educator evaluating a student's live recording or presentation.
    
    QUESTION:
    {question_text}
    
    LIVE RECORDING DATA:
    Transcript: {live_recording_transcript}
    Content Report: {live_recording_contentReport}
    Speech Report: {live_recording_speechReport}
    Body Language Score: {live_recording_bodyLanguageScore}
    Body Language Explanation: {live_recording_bodyLanguageExplanation}
    
    FEEDBACK INSTRUCTIONS:
    1. Carefully analyze the presentation data provided.
    2. Provide comprehensive, constructive feedback on:
       - Content quality and relevance
       - Speech clarity, pace, and engagement
       - Body language and delivery
       - Overall presentation effectiveness
    3. Highlight strengths and areas for improvement.
    4. Be specific, actionable, and supportive in your feedback.
    5. Structure your feedback in a clear, organized manner.
    
    Respond with a JSON object containing your detailed feedback according to the following format:
    {format_instructions}
    `;
  }
}
