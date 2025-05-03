/* eslint-disable unicorn/no-null */
// src/llm/features/question-generation/services/question-generation.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType, QuestionType, ResponseType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import { PROMPT_PROCESSOR, VALIDATOR_SERVICE } from "../../../llm.constants";
import { IQuestionGenerationService } from "../interfaces/question-generation.interface";
import { EnhancedQuestionsToGenerate } from "../../../../assignment/dto/post.assignment.request.dto";
import {
  Choice,
  ScoringDto,
  VariantDto,
} from "../../../../assignment/dto/update.questions.request.dto";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { Logger } from "winston";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { IQuestionValidatorService } from "../interfaces/question-validator.interface";

export enum AssignmentTypeEnum {
  QUIZ,
  ASSIGNMENT,
  PROJECT,
  MIDTERM,
  FINAL,
  EXAM,
  TEST,
  LAB,
  HOMEWORK,
  PRACTICE,
  ASSESSMENT,
  SURVEY,
  EVALUATION,
  REVIEW,
  REFLECTION,
}

// Define difficulty levels for more precise control
export enum DifficultyLevel {
  BASIC = "BASIC",
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  CHALLENGING = "CHALLENGING",
  ADVANCED = "ADVANCED",
}

// Aligned with frontend types from QuestionAuthorStore
interface IGeneratedQuestion {
  id?: number;
  question: string;
  totalPoints: number;
  type: QuestionType;
  responseType?: ResponseType;
  scoring: ScoringDto;
  choices?: Choice[];
  maxWords?: number;
  maxCharacters?: number;
  randomizedChoices?: boolean;
  variants?: VariantDto[];
  videoPresentationConfig?: VideoPresentationConfig;
  liveRecordingConfig?: LiveRecordingConfig;
  difficultyLevel?: DifficultyLevel;
}

interface VideoPresentationConfig {
  evaluateSlidesQuality: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}

interface LiveRecordingConfig {
  evaluateBodyLanguage: boolean;
  realTimeAiCoach: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}

@Injectable()
export class QuestionGenerationService implements IQuestionGenerationService {
  private readonly logger: Logger;
  private readonly MAX_GENERATION_RETRIES = 3;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(VALIDATOR_SERVICE)
    private readonly validatorService: IQuestionValidatorService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: QuestionGenerationService.name,
    });
  }

  /**
   * Main question generation function with quality guarantees
   */
  async generateAssignmentQuestions(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion[]> {
    // Validate inputs
    if (!content && !learningObjectives) {
      throw new HttpException(
        "Provide either content, learning objectives, or both",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Map assignment type to difficulty level
    const difficultyLevel = this.mapAssignmentTypeToDifficulty(assignmentType);

    // Generate questions with retry mechanism for quality assurance
    let questions: IGeneratedQuestion[] = [];
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        // Initial generation
        questions = await this.generateQuestions(
          assignmentId,
          difficultyLevel,
          questionsToGenerate,
          content,
          learningObjectives,
        );

        // Validate the generated questions
        const validationResult = await this.validatorService.validateQuestions(
          questions,
          questionsToGenerate,
          difficultyLevel,
          content,
          learningObjectives,
        );

        if (validationResult.isValid) {
          success = true;
          // If validation passes but has suggestions for improvement, refine the questions
          if (validationResult.hasImprovements) {
            questions = await this.refineQuestions(
              questions,
              validationResult.improvements,
              assignmentId,
            );
          }
        } else {
          // If validation fails, log the issues and retry
          this.logger.warn(
            `Question validation failed. Retrying. Issues: ${JSON.stringify(validationResult.issues)}`,
          );
          attemptsLeft--;

          if (attemptsLeft > 0) {
            // Refine the generation parameters based on validation feedback
            questions = await this.regenerateFailedQuestions(
              questions,
              validationResult.issues,
              questionsToGenerate,
              difficultyLevel,
              assignmentId,
              content,
              learningObjectives,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Error in question generation attempt: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        attemptsLeft--;
      }
    }

    // If all attempts failed, generate fallback questions
    if (!success) {
      this.logger.warn(
        "All generation attempts failed. Using enhanced fallback questions.",
      );
      questions = this.generateEnhancedFallbackQuestions(
        assignmentId,
        questionsToGenerate,
        difficultyLevel,
      );
    }

    // Ensure exact counts match what was requested
    return this.enforceExactQuestionCounts(
      questions,
      questionsToGenerate,
      difficultyLevel,
    );
  }

  /**
   * Maps assignment type to a specific difficulty level
   */
  private mapAssignmentTypeToDifficulty(
    assignmentType: AssignmentTypeEnum,
  ): DifficultyLevel {
    switch (assignmentType) {
      case AssignmentTypeEnum.PRACTICE: {
        return DifficultyLevel.BASIC;
      }
      case AssignmentTypeEnum.QUIZ:
      case AssignmentTypeEnum.HOMEWORK: {
        return DifficultyLevel.EASY;
      }
      case AssignmentTypeEnum.ASSIGNMENT:
      case AssignmentTypeEnum.LAB: {
        return DifficultyLevel.MEDIUM;
      }
      case AssignmentTypeEnum.MIDTERM:
      case AssignmentTypeEnum.TEST: {
        return DifficultyLevel.CHALLENGING;
      }
      case AssignmentTypeEnum.FINAL:
      case AssignmentTypeEnum.EXAM: {
        return DifficultyLevel.ADVANCED;
      }
      default: {
        return DifficultyLevel.MEDIUM;
      }
    }
  }

  /**
   * Calculate total questions from the configuration
   */
  private calculateTotalQuestions(
    questionsToGenerate: EnhancedQuestionsToGenerate,
  ): number {
    return (
      (questionsToGenerate.multipleChoice || 0) +
      (questionsToGenerate.multipleSelect || 0) +
      (questionsToGenerate.textResponse || 0) +
      (questionsToGenerate.trueFalse || 0) +
      (questionsToGenerate.url || 0) +
      (questionsToGenerate.upload || 0) +
      (questionsToGenerate.linkFile || 0)
    );
  }

  /**
   * Core question generation method with improved prompting
   */
  private async generateQuestions(
    assignmentId: number,
    difficultyLevel: DifficultyLevel,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion[]> {
    // Define comprehensive output schema aligned with frontend types
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        questions: z.array(
          z.object({
            question: z
              .string()
              .min(10)
              .describe(
                "The clear, specific question text appropriate for the difficulty level",
              ),
            type: z
              .enum([
                QuestionType.SINGLE_CORRECT,
                QuestionType.MULTIPLE_CORRECT,
                QuestionType.TEXT,
                QuestionType.TRUE_FALSE,
                QuestionType.URL,
                QuestionType.UPLOAD,
                QuestionType.LINK_FILE,
              ])
              .describe("The question type"),
            responseType: z
              .enum([
                ResponseType.CODE,
                ResponseType.ESSAY,
                ResponseType.REPORT,
              ])
              .optional()
              .describe("The expected response type"),
            totalPoints: z
              .number()
              .int()
              .min(1)
              .describe("The total points for this question"),
            difficultyLevel: z
              .enum([
                DifficultyLevel.BASIC,
                DifficultyLevel.EASY,
                DifficultyLevel.MEDIUM,
                DifficultyLevel.CHALLENGING,
                DifficultyLevel.ADVANCED,
              ])
              .describe("The difficulty level of this question"),
            maxWords: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Maximum word limit for text responses"),
            maxCharacters: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Maximum character limit for text responses"),
            randomizedChoices: z
              .boolean()
              .optional()
              .describe(
                "Whether choices should be randomized for each learner",
              ),
            scoring: z
              .object({
                type: z
                  .enum([ScoringType.CRITERIA_BASED])
                  .describe("The scoring type"),
                rubrics: z
                  .array(
                    z.object({
                      rubricQuestion: z
                        .string()
                        .min(5)
                        .describe(
                          "A question that evaluates a key aspect of the response",
                        ),
                      criteria: z
                        .array(
                          z.object({
                            description: z
                              .string()
                              .min(10)
                              .describe(
                                "Detailed description of the criterion",
                              ),
                            points: z
                              .number()
                              .int()
                              .min(0)
                              .describe(
                                "Unique whole point value - higher = better",
                              ),
                          }),
                        )
                        .min(3)
                        .max(5)
                        .describe(
                          "3-5 criteria with different point values (highest first)",
                        ),
                      showRubricsToLearner: z
                        .boolean()
                        .optional()
                        .describe("Whether to show rubrics to the learner"),
                    }),
                  )
                  .min(1)
                  .describe("Array of rubric questions with their criteria"),
              })
              .nullable()
              .optional(),
            choices: z
              .array(
                z.object({
                  choice: z
                    .string()
                    .describe("Answer choice text, must match isCorrect")
                    .min(1),
                  id: z.number().describe("Unique identifier for the choice"),
                  isCorrect: z
                    .boolean()
                    .describe("Is this the correct answer?"),
                  points: z
                    .number()
                    .int()
                    .describe("Points assigned for this choice"),
                  feedback: z
                    .string()
                    .optional()
                    .describe("Feedback for this choice"),
                }),
              )
              .nullable()
              .optional()
              .describe(
                "Answer choices for MULTIPLE_CHOICE/SINGLE_CHOICE or TRUE_FALSE questions",
              ),
            videoPresentationConfig: z
              .object({
                evaluateSlidesQuality: z.boolean(),
                evaluateTimeManagement: z.boolean(),
                targetTime: z.number(),
              })
              .optional(),
            liveRecordingConfig: z
              .object({
                evaluateBodyLanguage: z.boolean(),
                realTimeAiCoach: z.boolean(),
                evaluateTimeManagement: z.boolean(),
                targetTime: z.number(),
              })
              .optional(),
          }),
        ),
      }),
    );
    // Create specific question type instructions based on what's actually requested
    const questionTypeInstructions = [];

    // Only include instructions for question types that are actually requested
    if (
      questionsToGenerate.multipleChoice &&
      questionsToGenerate.multipleChoice > 0
    ) {
      questionTypeInstructions.push(`
     A. MULTIPLE_CHOICE questions:
        - Include exactly 4 choices for each question
        - One choice must be clearly correct
        - Distractors should be plausible (not obviously wrong)
        - Each choice must have detailed feedback explaining why it is correct/incorrect
        - Feedback should be educational, not just "Correct" or "Incorrect"
  `);
    }

    if (
      questionsToGenerate.multipleSelect &&
      questionsToGenerate.multipleSelect > 0
    ) {
      questionTypeInstructions.push(`
     B. MULTIPLE_SELECT questions:
        - Include exactly 4 choices for each question
        - 2 choices must be correct, 2 incorrect
        - All correct choices are required for full points
        - Each choice must have detailed feedback
  `);
    }

    if (
      questionsToGenerate.textResponse &&
      questionsToGenerate.textResponse > 0
    ) {
      questionTypeInstructions.push(`
     C. TEXT_RESPONSE questions:
        - Clear, specific prompt requiring detailed explanation
        - Include word/character limits appropriate to difficulty
        - Comprehensive rubric with 3 criteria, each with 4 levels
        - Criteria should focus on: Content Accuracy, Critical Thinking, and Organization
  `);
    }

    if (questionsToGenerate.trueFalse && questionsToGenerate.trueFalse > 0) {
      questionTypeInstructions.push(`
     D. TRUE_FALSE questions:
        - When creating multiple TRUE/FALSE questions, ensure: 
        - Each question is unique and covers a different aspect of the material
        - Make sure to include a variety of true and false statements
        - Clear, unambiguous statements that are definitively true or false
        - Test significant concepts, not trivia
        - Provide only a SINGLE choice for each TRUE/FALSE question
        - For true statements: set "choice" to "true" and "isCorrect" to true
        - For false statements: set "choice" to "false" and "isCorrect" to false
        - IMPORTANT: The "choice" value should accurately reflect whether the statement is true or false
        - Include detailed feedback explaining why the statement is true or false
  `);
    }

    if (
      (questionsToGenerate.url && questionsToGenerate.url > 0) ||
      (questionsToGenerate.upload && questionsToGenerate.upload > 0) ||
      (questionsToGenerate.linkFile && questionsToGenerate.linkFile > 0)
    ) {
      questionTypeInstructions.push(`
     E. URL/UPLOAD/LINK_FILE questions:
        - Clear expectations about what to submit
        - Detailed rubric with criteria specific to the expected submission
        - Appropriate response type setting
  `);
    }
    const typeSpecificRequirements =
      questionTypeInstructions.length > 0
        ? `3. Question Type-Specific Requirements:\n${questionTypeInstructions.join("\n")}`
        : `3. Question Type-Specific Requirements:\n    - Follow standard best practices for all question types`;

    // Load the enhanced generation template
    const template = await this.loadEnhancedQuestionGenerationTemplate();

    const formatInstructions = parser.getFormatInstructions();

    // Create a prompt with specific instructions about difficulty and quality
    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        format_instructions: () => formatInstructions,
        content: () => content ?? "",
        learning_objectives: () => learningObjectives ?? "",
        questionsToGenerate: () => JSON.stringify(questionsToGenerate),
        multipleChoice: () =>
          (questionsToGenerate.multipleChoice || 0).toString(),
        multipleSelect: () =>
          (questionsToGenerate.multipleSelect || 0).toString(),
        textResponse: () => (questionsToGenerate.textResponse || 0).toString(),
        trueFalse: () => (questionsToGenerate.trueFalse || 0).toString(),
        url: () => (questionsToGenerate.url || 0).toString(),
        upload: () => (questionsToGenerate.upload || 0).toString(),
        linkFile: () => (questionsToGenerate.linkFile || 0).toString(),
        responseTypes: () =>
          JSON.stringify(questionsToGenerate.responseTypes || {}),
        difficultyLevel: () => difficultyLevel,
        typeSpecificRequirements: () => typeSpecificRequirements,
        difficultyDescription: () =>
          this.getDifficultyDescription(difficultyLevel),
        difficultyGuidelines: () => {
          this.getDifficultyGuidanceForLevel(difficultyLevel);
          return `\nDIFFICULTY GUIDELINES:\n${this.getDifficultyGuidanceForLevel(difficultyLevel)}\n`;
        },
        contentAndObjectives: () => {
          const contentText = content
            ? `\nCONTENT:\n${content.slice(0, 500)}...\n`
            : "";
          const objectivesText = learningObjectives
            ? `\nLEARNING OBJECTIVES:\n${learningObjectives}\n`
            : "";
          return `${contentText}${objectivesText}`;
        },
      },
    });

    try {
      // Process the prompt through the LLM
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.ASSIGNMENT_GENERATION,
      );

      // Parse the response
      const parsed = await parser.parse(response);

      if (
        !parsed ||
        !parsed.questions ||
        !Array.isArray(parsed.questions) ||
        parsed.questions.length === 0
      ) {
        throw new Error("Response did not contain valid questions array");
      }
      // Extract the generated questions
      const generatedQuestions = parsed.questions as IGeneratedQuestion[];

      // Clean and format the generated questions
      return this.processGeneratedQuestions(generatedQuestions, assignmentId);
    } catch (error) {
      this.logger.error(
        `Error generating questions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Process generated questions to ensure they meet quality standards
   */
  private processGeneratedQuestions(
    rawQuestions: IGeneratedQuestion[],
    assignmentId: number,
  ): IGeneratedQuestion[] {
    // Clean up markdown and standardize question format
    return rawQuestions.map((question, index) => ({
      id: Date.now() + index,
      assignmentId,
      question: question.question?.replaceAll("```", "").trim(),
      totalPoints: question.totalPoints || this.getDefaultPoints(question.type),
      type: question.type,
      responseType:
        question.responseType || this.getDefaultResponseType(question.type),
      difficultyLevel: question.difficultyLevel,
      maxWords:
        question.maxWords ||
        this.getDefaultMaxWords(question.type, question.difficultyLevel),
      maxCharacters:
        question.maxCharacters ||
        this.getDefaultMaxCharacters(question.type, question.difficultyLevel),
      randomizedChoices:
        question.randomizedChoices === undefined
          ? [QuestionType.SINGLE_CORRECT, QuestionType.MULTIPLE_CORRECT]
              .map(String)
              .includes(String(question.type))
          : question.randomizedChoices,
      scoring:
        question.scoring ??
        (this.needsRubric(question.type)
          ? this.getDefaultScoring(question.type, question.difficultyLevel)
          : undefined),
      choices: this.processChoices(question),
    }));
  }

  /**
   * Process choices to ensure quality and consistency
   */
  private processChoices(question: IGeneratedQuestion): Choice[] | undefined {
    if (question.type === QuestionType.TRUE_FALSE) {
      // For TRUE/FALSE questions, we need special handling
      if (!question.choices || question.choices.length !== 1) {
        // If somehow there are no choices or more than one choice, create a default one
        return [
          {
            id: 1,
            choice: "true", // Default to true statement if no choice exists
            isCorrect: true, // isCorrect should match the choice
            points: 1,
            feedback: "This statement is correct based on the concept.",
          },
        ];
      }

      const originalChoice = question.choices[0];
      const choiceText = originalChoice.choice?.toLowerCase().trim();

      // Determine if the statement is true or false based on the choice
      const isStatementTrue = choiceText === "true";

      // Create the properly formatted choice
      return [
        {
          id: 1,
          choice: isStatementTrue ? "true" : "false",
          isCorrect: isStatementTrue,
          points: isStatementTrue ? originalChoice.points || 1 : 0,
          feedback:
            originalChoice.feedback?.replaceAll("```", "").trim() ||
            (isStatementTrue
              ? "This statement is correct."
              : "This statement is incorrect."),
        },
      ];
    }

    if (!question.choices) {
      return this.getDefaultChoices(question.type, question.difficultyLevel);
    }

    // Clean and normalize choices for other question types
    return question.choices.map((choice: Choice, index: number) => ({
      choice: choice.choice?.replaceAll("```", "").trim() || "",
      id: choice.id || index + 1,
      isCorrect: choice.isCorrect === true,
      points: choice.points || (choice.isCorrect ? 1 : 0),
      feedback:
        choice.feedback?.replaceAll("```", "").trim() ||
        (choice.isCorrect
          ? "This is the correct answer."
          : "This is not the correct answer."),
    }));
  }

  /**
   * Refine questions based on validation improvements
   */
  private async refineQuestions(
    questions: IGeneratedQuestion[],
    improvements: Record<number, string>,
    assignmentId: number,
  ): Promise<IGeneratedQuestion[]> {
    // For each question with improvements, apply the refinements
    const refinedQuestions = [...questions];

    for (const [index, improvement] of Object.entries(improvements)) {
      const questionIndex = Number.parseInt(index, 10);
      if (
        Number.isNaN(questionIndex) ||
        questionIndex < 0 ||
        questionIndex >= questions.length
      ) {
        continue;
      }

      try {
        const questionToImprove = questions[questionIndex];
        const improvedQuestion = await this.refineIndividualQuestion(
          questionToImprove,
          improvement,
          assignmentId,
        );

        refinedQuestions[questionIndex] = {
          ...questionToImprove,
          ...improvedQuestion,
        };
      } catch (error) {
        this.logger.warn(
          `Failed to refine question ${questionIndex}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        // Keep the original if refinement fails
      }
    }

    return refinedQuestions;
  }

  /**
   * Refine an individual question
   */
  private async refineIndividualQuestion(
    question: IGeneratedQuestion,
    improvement: string,
    assignmentId: number,
  ): Promise<Partial<IGeneratedQuestion>> {
    // Define schema for the improved question
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        question: z.string().min(10).optional(),
        choices: z
          .array(
            z.object({
              choice: z.string().min(1),
              id: z.number().int().min(1),
              isCorrect: z.boolean(),
              points: z.number().int().min(0).describe("whole point"),
              feedback: z.string().min(5).optional(),
            }),
          )
          .nullable()
          .optional()
          .describe(
            "For TRUE_FALSE, provide a single choice with value 'true'/'false'",
          ),
        scoring: z
          .object({
            type: z.literal(ScoringType.CRITERIA_BASED),
            rubrics: z.array(
              z.object({
                rubricQuestion: z.string(),
                criteria: z.array(
                  z.object({
                    description: z.string(),
                    points: z.number(),
                  }),
                ),
              }),
            ),
          })
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Create a prompt for refinement
    const template = `
    You are tasked with improving a specific question based on feedback.
    
    ORIGINAL QUESTION:
    ${JSON.stringify(question, null, 2)}
    
    IMPROVEMENT NEEDED:
    ${improvement}
    
    Your task:
    1. Apply the suggested improvement to the question
    2. Only return the parts of the question that need to be changed
    3. Ensure the improved version maintains the same difficulty level and core testing concept
    
    ${formatInstructions}
    `;

    // Process the refinement through the LLM
    const response = await this.promptProcessor.processPrompt(
      new PromptTemplate({ template, inputVariables: [] }),
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );
    const parsedResponse = await parser.parse(response);
    if (parsedResponse && parsedResponse.scoring) {
      parsedResponse.scoring.type = ScoringType.CRITERIA_BASED;
    }
    return parsedResponse as Partial<IGeneratedQuestion>;
  }

  /**
   * Regenerate failed questions based on validation feedback
   */
  private async regenerateFailedQuestions(
    questions: IGeneratedQuestion[],
    issues: Record<number, string[]>,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion[]> {
    const regeneratedQuestions = [...questions];

    const questionsByType = this.groupQuestionsByType(questions);

    for (const [indexString, questionIssues] of Object.entries(issues)) {
      const index = Number.parseInt(indexString, 10);
      if (Number.isNaN(index) || index < 0 || index >= questions.length) {
        continue;
      }

      const questionToFix = questions[index];

      try {
        // Regenerate the problematic question with specific guidance
        const fixedQuestion = await this.regenerateIndividualQuestion(
          questionToFix,
          questionIssues,
          difficultyLevel,
          assignmentId,
          content,
          learningObjectives,
        );

        regeneratedQuestions[index] = {
          ...fixedQuestion,
          id: questionToFix.id,
        };

        // Update our tracking
        this.updateQuestionTypeCount(
          questionsByType,
          questionToFix.type,
          fixedQuestion.type,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to regenerate question ${index}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        // Keep the original if regeneration fails
      }
    }

    // Ensure we still meet the required question type counts
    return this.enforceQuestionTypeCounts(
      regeneratedQuestions,
      questionsToGenerate,
      difficultyLevel,
    );
  }

  /**
   * Regenerate an individual problematic question
   */
  private async regenerateIndividualQuestion(
    question: IGeneratedQuestion,
    issues: string[],
    difficultyLevel: DifficultyLevel,
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        question: z.string().min(10).describe("The improved question text"),
        type: z
          .enum(Object.values(QuestionType) as [string, ...string[]])
          .describe("The question type"),
        responseType: z
          .enum(Object.values(ResponseType) as [string, ...string[]])
          .optional(),
        totalPoints: z.number().int().min(1),
        difficultyLevel: z.enum(
          Object.values(DifficultyLevel) as [string, ...string[]],
        ),
        maxWords: z.number().int().positive().optional(),
        maxCharacters: z.number().int().positive().optional(),
        randomizedChoices: z.boolean().optional(),
        choices: z
          .array(
            z.object({
              choice: z.string().min(1),
              id: z.number().int().min(1),
              isCorrect: z.boolean(),
              points: z.number().int().min(0).describe("whole point"),
              feedback: z.string().min(5).optional(),
            }),
          )
          .nullable()
          .optional()
          .describe(
            "For TRUE_FALSE, provide a single choice with value 'true' or 'false'",
          ),
        scoring: z
          .object({
            type: z.literal(ScoringType.CRITERIA_BASED),
            rubrics: z.array(
              z.object({
                rubricQuestion: z.string(),
                criteria: z.array(
                  z.object({
                    description: z.string(),
                    points: z.number().describe("whole point"),
                  }),
                ),
              }),
            ),
          })
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const contentContext = content
      ? `\nCONTENT CONTEXT:\n${content.slice(0, 500)}...\n`
      : "";
    const objectivesContext = learningObjectives
      ? `\nLEARNING OBJECTIVES:\n${learningObjectives}\n`
      : "";

    const template = `
    You are tasked with fixing a problematic question based on specific issues.
    
    ORIGINAL QUESTION:
    {question}
    
    ISSUES TO FIX:
    {issues.join('\n')}
    {contentContext}
    {objectivesContext}
    
    DIFFICULTY LEVEL:
    {difficultyLevel} - {getDifficultyDescription}
    
    Your task:
    1. Create a completely new question that addresses all the issues
    2. Ensure the new question meets the specified difficulty level
    3. Keep the same question type unless that's part of the issue
    4. Make sure all choices/rubrics are high quality and appropriate
    
    {formatInstructions}
    `;

    // Process the regeneration through the LLM
    const response = await this.promptProcessor.processPrompt(
      new PromptTemplate({
        template,
        inputVariables: [],
        partialVariables: {
          question: () => JSON.stringify(question, null, 2),
          issues: () => issues.join("\n"),
          difficultyLevel: () => difficultyLevel,
          getDifficultyDescription: () =>
            this.getDifficultyDescription(difficultyLevel),
          content: () => content,
          contentContext: () => contentContext,
          objectivesContext: () => objectivesContext,
          formatInstructions: () => formatInstructions,
        },
      }),
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );

    // Parse and clean the response
    const parsedQuestion = await parser.parse(response);

    // Process into the standard format
    return {
      id: question.id,
      question: parsedQuestion.question,
      type: parsedQuestion.type as QuestionType,
      responseType:
        (parsedQuestion.responseType as ResponseType) ||
        this.getDefaultResponseType(parsedQuestion.type as QuestionType),
      totalPoints: parsedQuestion.totalPoints,
      difficultyLevel: parsedQuestion.difficultyLevel as DifficultyLevel,
      maxWords:
        parsedQuestion.maxWords ||
        this.getDefaultMaxWords(
          parsedQuestion.type as QuestionType,
          parsedQuestion.difficultyLevel as DifficultyLevel,
        ),
      maxCharacters:
        parsedQuestion.maxCharacters ||
        this.getDefaultMaxCharacters(
          parsedQuestion.type as QuestionType,
          parsedQuestion.difficultyLevel as DifficultyLevel,
        ),
      randomizedChoices:
        parsedQuestion.randomizedChoices === undefined
          ? [QuestionType.SINGLE_CORRECT, QuestionType.MULTIPLE_CORRECT]
              .map(String)
              .includes(String(question.type))
          : parsedQuestion.randomizedChoices,
      scoring: parsedQuestion.scoring
        ? {
            type: ScoringType.CRITERIA_BASED,
            rubrics: Array.isArray(parsedQuestion.scoring.rubrics)
              ? parsedQuestion.scoring.rubrics.map((rubric) => ({
                  rubricQuestion:
                    rubric.rubricQuestion || "Evaluation criteria",
                  criteria: Array.isArray(rubric.criteria)
                    ? rubric.criteria.map((criterion) => ({
                        description:
                          criterion.description || "Missing description",
                        points:
                          typeof criterion.points === "number"
                            ? criterion.points
                            : 0,
                      }))
                    : [{ description: "Default criterion", points: 1 }],
                }))
              : [
                  {
                    rubricQuestion: "Default evaluation criteria",
                    criteria: [{ description: "Default criterion", points: 1 }],
                  },
                ],
          }
        : this.getDefaultScoring(
            parsedQuestion.type as QuestionType,
            parsedQuestion.difficultyLevel as DifficultyLevel,
          ),

      choices:
        parsedQuestion.choices?.map((choice, index) => ({
          id: index + 1,
          choice: choice.choice,
          isCorrect: choice.isCorrect,
          points: choice.points,
          feedback:
            choice.feedback ||
            (choice.isCorrect ? "Correct answer" : "Incorrect answer"),
        })) ||
        this.getDefaultChoices(
          parsedQuestion.type as QuestionType,
          parsedQuestion.difficultyLevel as DifficultyLevel,
        ),
    };
  }

  /**
   * Group questions by their type for tracking
   */
  private groupQuestionsByType(
    questions: IGeneratedQuestion[],
  ): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const question of questions) {
      counts[question.type] = (counts[question.type] || 0) + 1;
    }

    return counts;
  }

  /**
   * Update question type count when a type changes
   */
  private updateQuestionTypeCount(
    counts: Record<string, number>,
    oldType: QuestionType,
    newType: QuestionType,
  ): void {
    if (oldType !== newType) {
      counts[oldType] = (counts[oldType] || 1) - 1;
      counts[newType] = (counts[newType] || 0) + 1;
    }
  }

  /**
   * Enforce that we have the exact number of each question type
   */
  private enforceQuestionTypeCounts(
    questions: IGeneratedQuestion[],
    requirements: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
  ): IGeneratedQuestion[] {
    // Create a map of current question counts by type
    const currentCounts = this.groupQuestionsByType(questions);

    // Define the required counts
    const requiredCounts = {
      [QuestionType.SINGLE_CORRECT]: requirements.multipleChoice || 0,
      [QuestionType.MULTIPLE_CORRECT]: requirements.multipleSelect || 0,
      [QuestionType.TEXT]: requirements.textResponse || 0,
      [QuestionType.TRUE_FALSE]: requirements.trueFalse || 0,
      [QuestionType.URL]: requirements.url || 0,
      [QuestionType.UPLOAD]: requirements.upload || 0,
      [QuestionType.LINK_FILE]: requirements.linkFile || 0,
    };

    // Identify which types need more questions and which have extras
    const needMore: Record<string, number> = {};
    const haveExtra: Record<string, number> = {};

    for (const [type, required] of Object.entries(requiredCounts)) {
      const current = currentCounts[type] || 0;
      if (current < required) {
        needMore[type] = required - current;
      } else if (current > required) {
        haveExtra[type] = current - required;
      }
    }

    // Sort questions by quality (we'll keep the best ones)
    const sortedQuestions = [...questions].sort((a, b) => {
      // Keep questions without issues first
      const aHasIssues = this.questionHasIssues(a);
      const bHasIssues = this.questionHasIssues(b);

      if (aHasIssues !== bHasIssues) {
        return aHasIssues ? 1 : -1;
      }

      // Otherwise sort by question length (heuristic for detail/quality)
      return b.question.length - a.question.length;
    });

    // Remove extra questions of certain types (remove worst quality first)
    const questionsToKeep = sortedQuestions.filter((q) => {
      if (haveExtra[q.type] && haveExtra[q.type] > 0) {
        haveExtra[q.type]--;
        return false;
      }
      return true;
    });

    // Add missing questions of needed types
    for (const [type, count] of Object.entries(needMore)) {
      for (let index = 0; index < count; index++) {
        questionsToKeep.push(
          this.createTemplateQuestion(
            type as QuestionType,
            difficultyLevel,
            Date.now() + Math.floor(Math.random() * 10_000) + index,
          ),
        );
      }
    }

    return questionsToKeep;
  }

  /**
   * Check if a question has potential quality issues
   */
  private questionHasIssues(question: IGeneratedQuestion): boolean {
    if (question.question.length < 15) {
      return true;
    }
    if (question.type === QuestionType.TRUE_FALSE) {
      if (!question.choices || question.choices.length !== 1) {
        return true;
      }

      const choice = question.choices[0];

      const choiceValue = choice.choice?.toString().toLowerCase().trim();
      if (choiceValue !== "true" && choiceValue !== "false") {
        return true;
      }

      const isStatementTrue = choiceValue === "true";
      if (choice.isCorrect !== isStatementTrue) {
        return true;
      }

      if (!choice.feedback || choice.feedback.length < 5) {
        return true;
      }

      return false;
    }
    if (
      [QuestionType.SINGLE_CORRECT, QuestionType.MULTIPLE_CORRECT]
        .map(String)
        .includes(String(question.type))
    ) {
      if (!question.choices || question.choices.length < 2) {
        return true;
      }
      if (!question.choices.some((c) => c.isCorrect)) {
        return true;
      }
      if (
        question.type === QuestionType.SINGLE_CORRECT &&
        question.choices.filter((c) => c.isCorrect).length !== 1
      ) {
        return true;
      }
      if (question.choices.some((c) => !c.feedback || c.feedback.length < 5)) {
        return true;
      }
      const choiceTexts = question.choices.map((c) =>
        c.choice.toLowerCase().trim(),
      );
      if (new Set(choiceTexts).size !== choiceTexts.length) {
        return true;
      }
    }
    if (
      [
        QuestionType.TEXT,
        QuestionType.URL,
        QuestionType.UPLOAD,
        QuestionType.LINK_FILE,
      ]
        .map(String)
        .includes(String(question.type))
    ) {
      if (
        !question.scoring ||
        !question.scoring.rubrics ||
        question.scoring.rubrics.length === 0
      ) {
        return true;
      }
      for (const rubric of question.scoring.rubrics) {
        if (!rubric.criteria || rubric.criteria.length < 2) {
          return true;
        }
        const points = rubric.criteria.map((c) => c.points);
        if (new Set(points).size !== points.length) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Create a high-quality template question when generation fails
   */
  private createTemplateQuestion(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
    id?: number,
  ): IGeneratedQuestion {
    const questionId = id || Date.now() + Math.floor(Math.random() * 10_000);

    // Base template with type-specific refinements
    const baseTemplate: IGeneratedQuestion = {
      id: questionId,
      question: `[${type}] This is a template question that tests understanding at the ${difficultyLevel} level.`,
      totalPoints: this.getDefaultPoints(type),
      type: type,
      difficultyLevel: difficultyLevel,
      scoring: undefined,
      responseType: this.getDefaultResponseType(type),
    };

    // Add type-specific properties
    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return {
          ...baseTemplate,
          question: `Which of the following best describes the concept at a ${difficultyLevel} understanding level?`,
          randomizedChoices: true,
          choices: this.getHighQualityChoices(
            QuestionType.SINGLE_CORRECT,
            difficultyLevel,
          ),
        };
      }

      case QuestionType.MULTIPLE_CORRECT: {
        return {
          ...baseTemplate,
          question: `Select all of the following that correctly apply to the concept at a ${difficultyLevel} understanding level.`,
          randomizedChoices: true,
          choices: this.getHighQualityChoices(
            QuestionType.MULTIPLE_CORRECT,
            difficultyLevel,
          ),
        };
      }

      case QuestionType.TRUE_FALSE: {
        return {
          ...baseTemplate,
          question: `True or False: This statement tests understanding at the ${difficultyLevel} level.`,
          choices: this.getHighQualityChoices(
            QuestionType.TRUE_FALSE,
            difficultyLevel,
          ),
        };
      }

      case QuestionType.TEXT: {
        return {
          ...baseTemplate,
          question: `Explain the following concept in detail, demonstrating ${difficultyLevel} understanding.`,
          maxWords: this.getDefaultMaxWords(type, difficultyLevel),
          maxCharacters: this.getDefaultMaxCharacters(type, difficultyLevel),
          scoring: this.getDetailedScoring(type, difficultyLevel),
        };
      }

      case QuestionType.URL: {
        return {
          ...baseTemplate,
          question: `Provide a URL to a resource that demonstrates ${difficultyLevel} understanding of the concept.`,
          scoring: this.getDetailedScoring(type, difficultyLevel),
        };
      }

      case QuestionType.UPLOAD: {
        return {
          ...baseTemplate,
          question: `Upload a file that demonstrates ${difficultyLevel} understanding of the concept.`,
          scoring: this.getDetailedScoring(type, difficultyLevel),
        };
      }

      case QuestionType.LINK_FILE: {
        return {
          ...baseTemplate,
          question: `Link to a file or resource that demonstrates ${difficultyLevel} understanding of the concept.`,
          scoring: this.getDetailedScoring(type, difficultyLevel),
        };
      }

      default: {
        return baseTemplate;
      }
    }
  }

  /**
   * Get high-quality choices for template questions
   */
  private getHighQualityChoices(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
  ): Choice[] {
    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return [
          {
            id: 1,
            choice:
              "This is the correct answer with appropriate complexity for the difficulty level",
            isCorrect: true,
            points: this.getDefaultPoints(type),
            feedback: `This is correct. It demonstrates understanding at the ${difficultyLevel} level because it accurately captures the key concept.`,
          },
          {
            id: 2,
            choice:
              "This is a plausible but incorrect answer (common misconception)",
            isCorrect: false,
            points: 0,
            feedback:
              "This is incorrect. It represents a common misconception because it confuses a key aspect of the concept.",
          },
          {
            id: 3,
            choice:
              "This is another plausible but incorrect answer (partially correct)",
            isCorrect: false,
            points: 0,
            feedback:
              "This is incorrect. While it contains some truth, it misses critical elements of the complete answer.",
          },
          {
            id: 4,
            choice: "This is a clearly incorrect answer",
            isCorrect: false,
            points: 0,
            feedback:
              "This is incorrect. It demonstrates a fundamental misunderstanding of the concept.",
          },
        ];
      }

      case QuestionType.MULTIPLE_CORRECT: {
        return [
          {
            id: 1,
            choice: "This is the first correct answer",
            isCorrect: true,
            points: 1,
            feedback:
              "This is correct. It accurately describes one aspect of the concept.",
          },
          {
            id: 2,
            choice: "This is the second correct answer",
            isCorrect: true,
            points: 1,
            feedback:
              "This is also correct. It captures another important aspect of the concept.",
          },
          {
            id: 3,
            choice: "This is a plausible but incorrect answer",
            isCorrect: false,
            points: 0,
            feedback:
              "This is incorrect. It seems plausible but misrepresents the concept.",
          },
          {
            id: 4,
            choice: "This is another plausible but incorrect answer",
            isCorrect: false,
            points: 0,
            feedback:
              "This is incorrect. It represents a common misconception about the topic.",
          },
        ];
      }

      case QuestionType.TRUE_FALSE: {
        return [
          {
            id: 1,
            choice: "true",
            isCorrect: true,
            points: 1,
            feedback: "This statement is correct based on the concept.",
          },
        ];
      }

      default: {
        return [];
      }
    }
  }

  /**
   * Get detailed scoring rubrics for template questions
   */
  private getDetailedScoring(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
  ): ScoringDto {
    // Base rubric structure
    const baseRubric = {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion: "Content Accuracy and Comprehensiveness",
          criteria: [
            {
              description: `Excellent - Demonstrates complete and accurate understanding at a ${difficultyLevel} level`,
              points: 5,
            },
            {
              description:
                "Good - Shows mostly accurate understanding with minor gaps",
              points: 3,
            },
            {
              description:
                "Fair - Exhibits partial understanding with significant gaps",
              points: 1,
            },
            {
              description: "Poor - Shows minimal or incorrect understanding",
              points: 0,
            },
          ],
          showRubricsToLearner: true,
        },
        {
          rubricQuestion: "Critical Thinking and Analysis",
          criteria: [
            {
              description: `Excellent - Demonstrates exceptional critical analysis appropriate for ${difficultyLevel} level`,
              points: 5,
            },
            {
              description:
                "Good - Shows solid analytical thinking with some depth",
              points: 3,
            },
            {
              description: "Fair - Exhibits basic analysis with limited depth",
              points: 1,
            },
            {
              description: "Poor - Shows minimal or no analytical thinking",
              points: 0,
            },
          ],
          showRubricsToLearner: true,
        },
      ],
    };

    // Type-specific customizations
    switch (type) {
      case QuestionType.TEXT: {
        baseRubric.rubrics.push({
          rubricQuestion: "Organization and Clarity",
          criteria: [
            {
              description:
                "Excellent - Well-structured with clear, logical flow and precise language",
              points: 5,
            },
            {
              description:
                "Good - Generally organized with mostly clear expression",
              points: 3,
            },
            {
              description: "Fair - Somewhat disorganized with clarity issues",
              points: 1,
            },
            {
              description: "Poor - Poorly organized and difficult to follow",
              points: 0,
            },
          ],
          showRubricsToLearner: true,
        });
        break;
      }

      case QuestionType.URL: {
        baseRubric.rubrics.push({
          rubricQuestion: "Resource Quality and Relevance",
          criteria: [
            {
              description:
                "Excellent - Highly relevant, authoritative source with comprehensive information",
              points: 5,
            },
            {
              description:
                "Good - Relevant, credible source with useful information",
              points: 3,
            },
            {
              description:
                "Fair - Somewhat relevant source with basic information",
              points: 1,
            },
            {
              description: "Poor - Irrelevant or unreliable source",
              points: 0,
            },
          ],
          showRubricsToLearner: true,
        });
        break;
      }

      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        baseRubric.rubrics.push({
          rubricQuestion: "Document Quality and Completeness",
          criteria: [
            {
              description:
                "Excellent - Comprehensive, well-formatted document with all required elements",
              points: 5,
            },
            {
              description:
                "Good - Complete document with minor formatting or content issues",
              points: 3,
            },
            {
              description:
                "Fair - Basic document with significant gaps or formatting problems",
              points: 1,
            },
            {
              description: "Poor - Incomplete or poorly formatted document",
              points: 0,
            },
          ],
          showRubricsToLearner: true,
        });
        break;
      }
    }

    return baseRubric;
  }

  /**
   * Generate enhanced fallback questions as a last resort
   */
  private generateEnhancedFallbackQuestions(
    assignmentId: number,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
  ): IGeneratedQuestion[] {
    const fallbackQuestions: IGeneratedQuestion[] = [];

    // Add template questions for each required type
    // Multiple choice questions
    for (
      let index = 0;
      index < (questionsToGenerate.multipleChoice || 0);
      index++
    ) {
      fallbackQuestions.push(
        this.createTemplateQuestion(
          QuestionType.SINGLE_CORRECT,
          difficultyLevel,
          Date.now() + index,
        ),
      );
    }

    // Multiple select questions
    for (
      let index = 0;
      index < (questionsToGenerate.multipleSelect || 0);
      index++
    ) {
      fallbackQuestions.push(
        this.createTemplateQuestion(
          QuestionType.MULTIPLE_CORRECT,
          difficultyLevel,
          Date.now() + 100 + index,
        ),
      );
    }

    // Text response questions
    for (
      let index = 0;
      index < (questionsToGenerate.textResponse || 0);
      index++
    ) {
      fallbackQuestions.push(
        this.createTemplateQuestion(
          QuestionType.TEXT,
          difficultyLevel,
          Date.now() + 200 + index,
        ),
      );
    }

    // True/false questions
    for (let index = 0; index < (questionsToGenerate.trueFalse || 0); index++) {
      fallbackQuestions.push(
        this.createTemplateQuestion(
          QuestionType.TRUE_FALSE,
          difficultyLevel,
          Date.now() + 300 + index,
        ),
      );
    }

    // URL questions
    for (let index = 0; index < (questionsToGenerate.url || 0); index++) {
      const question = this.createTemplateQuestion(
        QuestionType.URL,
        difficultyLevel,
        Date.now() + 400 + index,
      );

      // Set response type from config if available
      if (questionsToGenerate.responseTypes?.URL) {
        question.responseType = this.getResponseTypeFromConfig(
          questionsToGenerate.responseTypes.URL,
          ResponseType.OTHER,
        );
      }

      fallbackQuestions.push(question);
    }

    // Upload questions
    for (let index = 0; index < (questionsToGenerate.upload || 0); index++) {
      const question = this.createTemplateQuestion(
        QuestionType.UPLOAD,
        difficultyLevel,
        Date.now() + 500 + index,
      );

      // Set response type from config if available
      if (questionsToGenerate.responseTypes?.UPLOAD) {
        question.responseType = this.getResponseTypeFromConfig(
          questionsToGenerate.responseTypes.UPLOAD,
          ResponseType.OTHER,
        );
      }

      fallbackQuestions.push(question);
    }

    // Link/file questions
    for (let index = 0; index < (questionsToGenerate.linkFile || 0); index++) {
      const question = this.createTemplateQuestion(
        QuestionType.LINK_FILE,
        difficultyLevel,
        Date.now() + 600 + index,
      );

      // Set response type from config if available
      if (questionsToGenerate.responseTypes?.LINK_FILE) {
        question.responseType = this.getResponseTypeFromConfig(
          questionsToGenerate.responseTypes.LINK_FILE,
          ResponseType.OTHER,
        );
      }

      fallbackQuestions.push(question);
    }

    return fallbackQuestions;
  }

  /**
   * Helper to get response type from config or default
   */
  private getResponseTypeFromConfig(
    configType: ResponseType | ResponseType[] | undefined,
    defaultType: ResponseType,
  ): ResponseType {
    if (Array.isArray(configType) && configType.length > 0) {
      return configType[0];
    }
    return defaultType;
  }

  /**
   * Get default points based on question type and difficulty
   */
  private getDefaultPoints(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number {
    switch (questionType) {
      case QuestionType.SINGLE_CORRECT: {
        return difficultyLevel === DifficultyLevel.ADVANCED ? 2 : 1;
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return difficultyLevel === DifficultyLevel.ADVANCED ? 3 : 2;
      }
      case QuestionType.TRUE_FALSE: {
        return 1;
      }
      case QuestionType.TEXT: {
        switch (difficultyLevel) {
          case DifficultyLevel.BASIC: {
            return 5;
          }
          case DifficultyLevel.EASY: {
            return 7;
          }
          case DifficultyLevel.MEDIUM: {
            return 10;
          }
          case DifficultyLevel.CHALLENGING: {
            return 15;
          }
          default: {
            return 20;
          }
        }
      }
      case QuestionType.URL:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        switch (difficultyLevel) {
          case DifficultyLevel.BASIC: {
            return 5;
          }
          case DifficultyLevel.EASY: {
            return 8;
          }
          case DifficultyLevel.MEDIUM: {
            return 10;
          }
          case DifficultyLevel.CHALLENGING: {
            return 12;
          }
          default: {
            return 15;
          }
        }
      }
      default: {
        return 5;
      }
    }
  }

  /**
   * Get default max words based on question type and difficulty
   */
  private getDefaultMaxWords(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number | undefined {
    if (questionType === QuestionType.TEXT) {
      switch (difficultyLevel) {
        case DifficultyLevel.BASIC: {
          return 150;
        }
        case DifficultyLevel.EASY: {
          return 250;
        }
        case DifficultyLevel.MEDIUM: {
          return 400;
        }
        case DifficultyLevel.CHALLENGING: {
          return 600;
        }
        default: {
          return 800;
        }
      }
    }
    return undefined;
  }

  /**
   * Get default max characters based on question type and difficulty
   */
  private getDefaultMaxCharacters(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number | undefined {
    if (questionType === QuestionType.TEXT) {
      switch (difficultyLevel) {
        case DifficultyLevel.BASIC: {
          return 1000;
        }
        case DifficultyLevel.EASY: {
          return 1500;
        }
        case DifficultyLevel.MEDIUM: {
          return 2500;
        }
        case DifficultyLevel.CHALLENGING: {
          return 3500;
        }
        default: {
          return 5000;
        }
      }
    }
    return undefined;
  }

  /**
   * Get default response type based on question type
   */
  private getDefaultResponseType(questionType: QuestionType): ResponseType {
    switch (questionType) {
      case QuestionType.TEXT: {
        return ResponseType.OTHER;
      }
      case QuestionType.URL: {
        return ResponseType.OTHER;
      }
      case QuestionType.UPLOAD: {
        return ResponseType.OTHER;
      }
      case QuestionType.LINK_FILE: {
        return ResponseType.OTHER;
      }
      default: {
        return ResponseType.OTHER;
      }
    }
  }

  /**
   * Get default video presentation config
   */
  private getDefaultVideoPresentationConfig(): VideoPresentationConfig {
    return {
      evaluateSlidesQuality: true,
      evaluateTimeManagement: true,
      targetTime: 300, // 5 minutes in seconds
    };
  }

  /**
   * Get default live recording config
   */
  private getDefaultLiveRecordingConfig(): LiveRecordingConfig {
    return {
      evaluateBodyLanguage: true,
      realTimeAiCoach: true,
      evaluateTimeManagement: true,
      targetTime: 300, // 5 minutes in seconds
    };
  }

  /**
   * Get detailed difficulty description based on level
   */
  private getDifficultyDescription(difficultyLevel: DifficultyLevel): string {
    switch (difficultyLevel) {
      case DifficultyLevel.BASIC: {
        return "Basic level - Tests recall and basic comprehension of fundamental concepts. Questions focus on definition, identification, and simple applications with straightforward answers.";
      }
      case DifficultyLevel.EASY: {
        return "Easy level - Tests understanding of concepts and simple applications. Questions require comprehension and basic problem-solving with clearly defined parameters.";
      }
      case DifficultyLevel.MEDIUM: {
        return "Medium level - Tests application and analysis of concepts. Questions require deeper understanding, ability to connect concepts, and solving problems with some complexity.";
      }
      case DifficultyLevel.CHALLENGING: {
        return "Challenging level - Tests evaluation and synthesis of concepts. Questions require critical thinking, comparing different approaches, and solving complex problems with multiple variables.";
      }
      case DifficultyLevel.ADVANCED: {
        return "Advanced level - Tests creation and innovation based on deep understanding. Questions require expertise, creative problem-solving, independent analysis, and handling exceptional cases.";
      }
      default: {
        return "Medium difficulty level requiring solid understanding and application of concepts.";
      }
    }
  }

  /**
   * Need rubric check for question types
   */
  private needsRubric(questionType: QuestionType): boolean {
    return [
      QuestionType.TEXT,
      QuestionType.URL,
      QuestionType.UPLOAD,
      QuestionType.LINK_FILE,
    ]
      .map(String)
      .includes(String(questionType));
  }

  /**
   * Get default scoring for different question types with difficulty adjustment
   */
  private getDefaultScoring(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): ScoringDto {
    // Get the appropriate difficulty description
    const difficultyDesc = difficultyLevel || DifficultyLevel.MEDIUM;
    const levelText = difficultyDesc.toLowerCase();

    switch (questionType) {
      case QuestionType.TEXT: {
        return {
          type: ScoringType.CRITERIA_BASED,
          showRubricsToLearner: true,
          rubrics: [
            {
              rubricQuestion: "Content Accuracy and Comprehensiveness",
              criteria: [
                {
                  description: `Excellent - Complete and accurate answer demonstrating ${levelText} understanding with comprehensive details`,
                  points: 5,
                },
                {
                  description: `Good - Mostly accurate with minor omissions, showing adequate ${levelText} understanding`,
                  points: 3,
                },
                {
                  description: `Fair - Partially accurate with significant gaps in ${levelText} understanding`,
                  points: 1,
                },
                {
                  description: `Poor - Mostly incorrect or off-topic, lacking ${levelText} understanding`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Critical Thinking and Analysis",
              criteria: [
                {
                  description: `Excellent - Demonstrates exceptional critical analysis appropriate for ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Shows solid analytical thinking with some ${levelText} depth`,
                  points: 3,
                },
                {
                  description: `Fair - Exhibits basic analysis with limited ${levelText} depth`,
                  points: 1,
                },
                {
                  description: `Poor - Shows minimal or no analytical thinking at ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Organization and Clarity",
              criteria: [
                {
                  description: `Excellent - Well-structured with clear, logical flow and precise language at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Generally organized with mostly clear expression at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Somewhat disorganized with clarity issues at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Poorly organized and difficult to follow at ${levelText} level`,
                  points: 0,
                },
              ],
            },
          ],
        };
      }
      case QuestionType.URL:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        return {
          type: ScoringType.CRITERIA_BASED,
          showRubricsToLearner: true,
          rubrics: [
            {
              rubricQuestion: "Relevance to Question",
              criteria: [
                {
                  description: `Excellent - Directly addresses the question with specific details at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Mostly relevant with minor tangents at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Somewhat relevant but with major gaps at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Not relevant to the question at ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Quality and Depth of Content",
              criteria: [
                {
                  description: `Excellent - High-quality, comprehensive content with insightful ${levelText}-level analysis`,
                  points: 5,
                },
                {
                  description: `Good - Good quality content with some ${levelText}-level insights`,
                  points: 3,
                },
                {
                  description: `Fair - Basic content that meets minimum ${levelText}-level requirements`,
                  points: 1,
                },
                {
                  description: `Poor - Low-quality or insufficient content for ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Professional Presentation",
              criteria: [
                {
                  description: `Excellent - Professional, well-formatted presentation at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Generally professional presentation with minor issues at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Basic presentation with notable issues at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Poor presentation unsuitable for ${levelText} level`,
                  points: 0,
                },
              ],
            },
          ],
        };
      }
      default: {
        return {
          type: ScoringType.CRITERIA_BASED,
          rubrics: [],
        };
      }
    }
  }

  /**
   * Get default choices with difficulty adjustment
   */
  private getDefaultChoices(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): Choice[] | undefined {
    // Get difficulty level text for feedback
    const levelText = difficultyLevel?.toLowerCase() || "medium";

    switch (questionType) {
      case QuestionType.SINGLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `This is the correct answer with appropriate ${levelText}-level complexity`,
            isCorrect: true,
            points: this.getDefaultPoints(questionType, difficultyLevel),
            feedback: `This is correct. It demonstrates understanding at the ${levelText} level because it accurately captures the key concept.`,
          },
          {
            id: 2,
            choice: `This is a plausible but incorrect answer (common ${levelText}-level misconception)`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It represents a common misconception at the ${levelText} level because it confuses a key aspect of the concept.`,
          },
          {
            id: 3,
            choice: `This is another plausible but incorrect answer (partially correct at ${levelText} level)`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. While it contains some truth, it misses critical elements required at the ${levelText} level.`,
          },
          {
            id: 4,
            choice: `This is a clearly incorrect answer at ${levelText} level`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It demonstrates a fundamental misunderstanding of the ${levelText}-level concept.`,
          },
        ];
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `This is the first correct answer at ${levelText} level`,
            isCorrect: true,
            points: 1,
            feedback: `This is correct. It accurately describes one aspect of the ${levelText}-level concept.`,
          },
          {
            id: 2,
            choice: `This is the second correct answer at ${levelText} level`,
            isCorrect: true,
            points: 1,
            feedback: `This is also correct. It captures another important aspect of the ${levelText}-level concept.`,
          },
          {
            id: 3,
            choice: `This is a plausible but incorrect answer at ${levelText} level`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It seems plausible but misrepresents the ${levelText}-level concept.`,
          },
          {
            id: 4,
            choice: `This is another plausible but incorrect answer at ${levelText} level`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It represents a common misconception about the ${levelText}-level topic.`,
          },
        ];
      }
      case QuestionType.TRUE_FALSE: {
        return [
          {
            id: 1,
            choice: "true",
            isCorrect: true,
            points: 1,
            feedback: `This statement is correct based on the ${levelText}-level concept.`,
          },
        ];
      }
      default: {
        return undefined;
      }
    }
  }

  /**
   * Enforce exact question counts as a final check
   */
  private enforceExactQuestionCounts(
    questions: IGeneratedQuestion[],
    requirements: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
  ): IGeneratedQuestion[] {
    // Group questions by type
    const questionsByType: Record<QuestionType, IGeneratedQuestion[]> = {
      [QuestionType.SINGLE_CORRECT]: [],
      [QuestionType.MULTIPLE_CORRECT]: [],
      [QuestionType.TEXT]: [],
      [QuestionType.TRUE_FALSE]: [],
      [QuestionType.URL]: [],
      [QuestionType.UPLOAD]: [],
      [QuestionType.LINK_FILE]: [],
    };

    // Sort questions into their type groups
    for (const question of questions) {
      questionsByType[question.type] = questionsByType[question.type] || [];
      questionsByType[question.type].push(question);
    }

    // Define required counts
    const typeCounts = {
      [QuestionType.SINGLE_CORRECT]: requirements.multipleChoice || 0,
      [QuestionType.MULTIPLE_CORRECT]: requirements.multipleSelect || 0,
      [QuestionType.TEXT]: requirements.textResponse || 0,
      [QuestionType.TRUE_FALSE]: requirements.trueFalse || 0,
      [QuestionType.URL]: requirements.url || 0,
      [QuestionType.UPLOAD]: requirements.upload || 0,
      [QuestionType.LINK_FILE]: requirements.linkFile || 0,
    };

    // Final question collection
    const finalQuestions: IGeneratedQuestion[] = [];

    // For each question type, ensure exact count
    for (const [typeString, requiredCount] of Object.entries(typeCounts)) {
      const type = typeString as QuestionType;
      const availableQuestions = questionsByType[type] || [];

      // If we need more questions of this type, create them
      if (availableQuestions.length < requiredCount) {
        const additionalCount = requiredCount - availableQuestions.length;

        for (let index = 0; index < additionalCount; index++) {
          const newQuestion = this.createTemplateQuestion(
            type,
            difficultyLevel,
            Date.now() + Math.floor(Math.random() * 10_000) + index,
          );

          // Apply response type from requirements if available
          if (type === QuestionType.URL && requirements.responseTypes?.URL) {
            newQuestion.responseType = this.getResponseTypeFromConfig(
              requirements.responseTypes.URL,
              ResponseType.OTHER,
            );
          } else if (
            type === QuestionType.UPLOAD &&
            requirements.responseTypes?.UPLOAD
          ) {
            newQuestion.responseType = this.getResponseTypeFromConfig(
              requirements.responseTypes.UPLOAD,
              ResponseType.OTHER,
            );
          } else if (
            type === QuestionType.LINK_FILE &&
            requirements.responseTypes?.LINK_FILE
          ) {
            newQuestion.responseType = this.getResponseTypeFromConfig(
              requirements.responseTypes.LINK_FILE,
              ResponseType.OTHER,
            );
          }

          availableQuestions.push(newQuestion);
        }
      }

      const sortedQuestions = [...availableQuestions].sort((a, b) => {
        // Priority 1: Questions without quality issues
        const aHasIssues = this.questionHasIssues(a);
        const bHasIssues = this.questionHasIssues(b);

        if (aHasIssues !== bHasIssues) {
          return aHasIssues ? 1 : -1;
        }

        // Priority 2: Non-template questions (longer question text is a proxy for non-template)
        const aIsTemplate =
          a.question.includes("template") || a.question.includes("[");
        const bIsTemplate =
          b.question.includes("template") || b.question.includes("[");

        if (aIsTemplate !== bIsTemplate) {
          return aIsTemplate ? 1 : -1;
        }

        // Priority 3: Question length/complexity
        return b.question.length - a.question.length;
      });

      // Add exactly the required number of questions for this type
      finalQuestions.push(...sortedQuestions.slice(0, requiredCount));
    }

    return finalQuestions;
  }
  /**
   * Load enhanced question generation template with difficulty focus and only selected question types
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async loadEnhancedQuestionGenerationTemplate(): Promise<string> {
    // Template with stronger emphasis on difficulty calibration
    return `
  You are an expert teacher and assessment designer tasked with creating high-quality questions tailored to specific difficulty levels.
  
  DIFFICULTY LEVEL: {difficultyLevel}
  DIFFICULTY DESCRIPTION: {difficultyDescription}
  
  CONTENT AND OBJECTIVES: {contentAndObjectives}
  
  QUESTION DISTRIBUTION REQUIREMENTS:
  - Create EXACTLY these numbers of questions (no more, no less):
    - MULTIPLE_CHOICE (SINGLE_CORRECT): {multipleChoice} questions
    - MULTIPLE_SELECT (MULTIPLE_CORRECT): {multipleSelect} questions
    - TEXT_RESPONSE: {textResponse} questions
    - TRUE_FALSE: {trueFalse} questions
    - URL: {url} questions
    - UPLOAD: {upload} questions
    - LINK_FILE: {linkFile} questions
  
  QUALITY REQUIREMENTS:
  - Points has to be in whole numbers
  - Choose a suitable response type questions if not specified
  
  1. Content Alignment:
     - Questions must directly relate to the provided content/objectives
     - Each question should focus on a different aspect of the material
     - Ensure coverage of the full scope of material across all questions
  
  2. Difficulty Calibration:
     - All questions MUST match the specified difficulty level exactly
     - Use appropriate cognitive complexity (Bloom's taxonomy)
     - {difficultyGuidelines}
  
  {typeSpecificRequirements}
  
  4. Language Quality:
     - Use clear, precise language
     - No grammatical or spelling errors
     - Questions should be concise yet complete
     - Avoid ambiguity or confusion
  
  FORMAT REQUIREMENTS:
  {format_instructions}
  `;
  }

  /**
   * Get specific difficulty guidance based on level
   */
  private getDifficultyGuidanceForLevel(
    difficultyLevel: DifficultyLevel,
  ): string {
    switch (difficultyLevel) {
      case DifficultyLevel.BASIC: {
        return `
        - Focus on recall and recognition of fundamental concepts
        - Use terms like "identify," "define," "list," "describe"
        - Test simple factual knowledge with straightforward answers
        - Questions should verify basic comprehension, not application
        `;
      }

      case DifficultyLevel.EASY: {
        return `
        - Test basic understanding and simple application
        - Use terms like "explain," "summarize," "classify," "compare"
        - Questions should require connecting related concepts
        - Allow for some basic problem-solving with clear parameters
        `;
      }

      case DifficultyLevel.MEDIUM: {
        return `
        - Test application and analysis of concepts
        - Use terms like "apply," "implement," "analyze," "differentiate"
        - Questions should require deeper understanding of relationships
        - Include some complexity that requires careful consideration
        `;
      }

      case DifficultyLevel.CHALLENGING: {
        return `
        - Test evaluation and synthesis of complex concepts
        - Use terms like "evaluate," "assess," "critique," "formulate"
        - Questions should involve comparing different approaches
        - Require integration of multiple concepts to solve problems
        - Include nuance that differentiates partial from complete understanding
        `;
      }

      case DifficultyLevel.ADVANCED: {
        return `
        - Test creation, innovation, and mastery
        - Use terms like "create," "design," "develop," "optimize"
        - Questions should require expert-level understanding
        - Test ability to handle exceptional cases and edge scenarios
        - Require independent critical analysis of complex situations
        `;
      }

      default: {
        return `
        - Match question complexity to the medium difficulty level
        - Balance factual recall with analytical thinking
        - Questions should be neither too basic nor too advanced
        `;
      }
    }
  }

  /**
   * Generate question rewordings with improved quality
   */
  async generateQuestionRewordings(
    questionText: string,
    variationCount: number,
    questionType: QuestionType,
    assignmentId: number,
    choices?: Choice[],
    variants?: VariantDto[],
  ): Promise<
    {
      id: number;
      variantContent: string;
      choices: Choice[];
    }[]
  > {
    // Define base schema
    const baseQuestionSchema = z.object({
      id: z.number().describe("Unique identifier for the variation"),
      variantContent: z
        .string()
        .min(10)
        .describe(
          "A reworded variation of the question text that preserves the original meaning and difficulty",
        ),
    });

    // Schema for TRUE_FALSE questions
    const trueFalseQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("TRUE_FALSE"),
      choices: z
        .array(
          z.object({
            choice: z.enum(["true", "false", "True", "False"]),
            points: z.number().min(1),
            feedback: z.string().optional(),
            isCorrect: z.boolean(),
          }),
        )
        .length(1),
    });

    // Schema for MULTIPLE_CORRECT questions
    const multipleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      choices: z
        .array(
          z.object({
            choice: z.string().min(1),
            points: z
              .number()
              .min(0)
              .describe("Whole Points assigned for this choice"),
            feedback: z.string().min(5).optional(),
            isCorrect: z.boolean(),
          }),
        )
        .min(3),
    });

    // Schema for SINGLE_CORRECT questions
    const singleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      choices: z
        .array(
          z.object({
            choice: z.string().min(1),
            points: z
              .number()
              .min(0)
              .describe("Whole Points assigned for this choice"),
            feedback: z.string().min(5).optional(),
            isCorrect: z.boolean(),
          }),
        )
        .min(3),
    });

    // Select the appropriate schema based on question type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parser: StructuredOutputParser<any>;
    switch (questionType) {
      case QuestionType.TRUE_FALSE: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(trueFalseQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      case QuestionType.MULTIPLE_CORRECT: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(multipleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      case QuestionType.SINGLE_CORRECT: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(singleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      default: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(baseQuestionSchema).min(1).max(variationCount),
        );
      }
    }

    const formatInstructions = parser.getFormatInstructions();

    // Enhanced template for question rewordings
    /* ───────────────────── template with placeholders only ──────────────────── */
    const template = `
You are an expert assessment designer tasked with creating variations of a question while preserving its difficulty and core testing concept.

ORIGINAL QUESTION:
{originalQuestion}

{choicesSection}{variantsSection}
NUMBER OF VARIATIONS REQUESTED: {variationCount}

QUALITY REQUIREMENTS:
1. Create exactly {variationCount} high-quality variations
2. Each variation must:
   - Preserve the exact same difficulty level as the original
   - Test the same knowledge/skill as the original
   - Be clearly distinct from the original and other variations
   - Use precise language with no ambiguity
   - Have proper grammar and spelling

3. For choice-based questions:
   - Maintain the same pattern of correct/incorrect answers
   - Reword ALL answer choices for each variation
   - Ensure distractors remain equally plausible
   - Provide educational feedback for each choice
   - Keep original point distribution

4. Avoid simply:
   - Changing minor words or punctuation
   - Rearranging sentence structure only
   - Creating awkward or unnatural phrasing

FORMAT INSTRUCTIONS:
{format_instructions}
`;

    /* ───────────────────── PromptTemplate with partialVariables ─────────────── */
    const prompt = new PromptTemplate({
      template,
      inputVariables: [],

      partialVariables: {
        format_instructions: () => formatInstructions,
        originalQuestion: () => questionText,

        variationCount: () => String(variationCount),

        // optional sections rendered only when relevant
        choicesSection: () =>
          choices && choices.length > 0
            ? `ORIGINAL CHOICES:\n${JSON.stringify(choices, null, 2)}\n\n`
            : "",

        variantsSection: () =>
          variants && variants.length > 0
            ? `EXISTING VARIANTS:\n${JSON.stringify(variants, null, 2)}\n\n`
            : "",
      },
    });

    let response: string | undefined;
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        response = await this.promptProcessor.processPrompt(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
        );

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsedResponse = await parser.parse(response); // validates
        if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
          success = true;
        } else {
          throw new Error("Response did not contain valid question variations");
        }
      } catch (error) {
        this.logger.warn(
          `Error generating question variations (attempt ${
            this.MAX_GENERATION_RETRIES - attemptsLeft + 1
          }): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        attemptsLeft--;
      }
    }

    if (!success || !response) {
      this.logger.error(
        "Failed to generate question variations after all attempts",
      );
      throw new HttpException(
        "Failed to generate question variations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      // Define the type for the parsed response
      interface QuestionRewording {
        id: number;
        variantContent: string;
        choices?: Choice[];
      }

      const parsedResponse = (await parser.parse(
        response,
      )) as QuestionRewording[];

      // Ensure result is an array
      const responseArray = Array.isArray(parsedResponse)
        ? parsedResponse
        : [parsedResponse];

      // Map to expected format with quality checks
      return responseArray.map((item, index) => {
        // Base variant
        const variant = {
          id: (item as { id: number }).id ?? index + 1,
          variantContent:
            (item as { variantContent: string }).variantContent ?? "",
          choices: [],
        };

        // Process choices if applicable
        if ("choices" in item && Array.isArray(item.choices)) {
          variant.choices = (item as { choices?: Choice[] }).choices?.map(
            (rewordedChoice: Choice, choiceIndex: number) => {
              const originalChoice =
                choices && choiceIndex < choices.length
                  ? choices[choiceIndex]
                  : null;
              return {
                choice: rewordedChoice.choice,
                points:
                  rewordedChoice.points ??
                  originalChoice?.points ??
                  (rewordedChoice.isCorrect ? 1 : 0),
                feedback:
                  rewordedChoice.feedback ||
                  originalChoice?.feedback ||
                  (rewordedChoice.isCorrect
                    ? "This is the correct answer."
                    : "This is not the correct answer."),
                isCorrect: rewordedChoice.isCorrect === true,
                id: originalChoice?.id ?? choiceIndex + 1,
              };
            },
          );
        } else if (choices) {
          // If no choices in response but original had choices, use original structure with new IDs
          variant.choices = choices.map((choice, index_) => ({
            ...choice,
            id: index_ + 1,
          }));
        }

        return variant;
      });
    } catch (error) {
      this.logger.error(
        `Error parsing question rewordings: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to parse question rewordings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Generate contextual relationships between questions with improved reliability
   */
  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>> {
    if (!questions || questions.length === 0) {
      return {};
    }

    // Define output schema
    const parser = StructuredOutputParser.fromZodSchema(
      z.array(
        z
          .object({
            questionId: z.number().describe("The id of the question"),
            contextQuestions: z
              .array(z.number())
              .describe(
                "The ids of all the questions that this question depends upon contextually",
              ),
          })
          .describe(
            "Array of objects, where each object represents a question and its contextual dependencies.",
          ),
      ),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Enhanced template with more guidance
    const template = `
    You are an expert assessment designer tasked with identifying contextual relationships between questions in an assignment.
    
    A contextual relationship means that understanding or answering one question correctly may depend on knowledge
    from another question or its expected answer. This helps create a dependency graph for grading.
    
    QUESTIONS:
    {questions}
    
    INSTRUCTIONS:
    
    1. Carefully analyze each question to identify if it builds upon or requires knowledge from other questions.
    
    2. For each question, provide an array of IDs of questions it depends on contextually.
       - For example, if Question 5 requires knowledge tested in Questions 2 and 3, then Question 5 has context
         dependencies on Questions 2 and 3.
       - If a question is independent and doesn't rely on other questions, return an empty array.
       - Only include DIRECT dependencies (if A depends on B and B depends on C, A's dependencies should include
         B but not necessarily C).
    
    3. Be careful to avoid creating circular dependencies (A depends on B depends on A).
    
    4. Return a complete array with an entry for EVERY question, even those with no dependencies.
    
    {formatInstructions}
    `;

    // Process the prompt with retry mechanism for reliability
    let response: string | undefined;
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        response = await this.promptProcessor.processPrompt(
          new PromptTemplate({
            template,
            inputVariables: [],
            partialVariables: {
              questions: JSON.stringify(questions, null, 2),
              formatInstructions,
            },
          }),
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
        );

        // Parse and validate the response
        const parsedResponse = await parser.parse(response);

        // Simple validation checks
        if (!Array.isArray(parsedResponse)) {
          throw new TypeError("Response is not an array");
        }

        if (parsedResponse.length !== questions.length) {
          throw new Error(
            `Expected ${questions.length} items in response, got ${parsedResponse.length}`,
          );
        }

        // Check for circular dependencies
        const dependencies: Record<number, Set<number>> = {};
        for (const item of parsedResponse) {
          dependencies[item.questionId] = new Set(item.contextQuestions);
        }

        if (this.hasCircularDependencies(dependencies)) {
          throw new Error("Circular dependencies detected in response");
        }

        // If we get here, the response is valid
        success = true;
      } catch (error) {
        this.logger.warn(
          `Error generating question dependencies (attempt ${this.MAX_GENERATION_RETRIES - attemptsLeft + 1}): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        attemptsLeft--;
      }
    }

    if (!success || !response) {
      this.logger.error(
        "Failed to generate question dependencies after all attempts",
      );
      return this.generateFallbackDependencies(questions);
    }

    try {
      // Parse the response into the expected output format
      const parsedResponse = await parser.parse(response);

      // Convert array to map for easier access
      const gradingContextQuestionMap: Record<number, number[]> = {};
      for (const item of parsedResponse) {
        gradingContextQuestionMap[item.questionId] = item.contextQuestions;
      }

      return gradingContextQuestionMap;
    } catch (error) {
      this.logger.error(
        `Error parsing question context: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return this.generateFallbackDependencies(questions);
    }
  }

  /**
   * Check if the dependency graph has any circular dependencies
   */
  private hasCircularDependencies(
    dependencies: Record<number, Set<number>>,
  ): boolean {
    // Helper function to check for cycles
    const checkCycle = (
      nodeId: number,
      visited: Set<number>,
      path: Set<number>,
    ): boolean => {
      if (path.has(nodeId)) {
        return true; // Cycle detected
      }

      if (visited.has(nodeId)) {
        return false; // Already checked, no cycle
      }

      visited.add(nodeId);
      path.add(nodeId);

      // Check all dependencies
      const nodeDeps = dependencies[nodeId] || new Set();
      for (const depId of nodeDeps) {
        if (checkCycle(depId, visited, path)) {
          return true;
        }
      }

      path.delete(nodeId);
      return false;
    };

    // Check from each node
    const visited = new Set<number>();
    for (const nodeId of Object.keys(dependencies).map(Number)) {
      if (checkCycle(nodeId, visited, new Set())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate fallback dependencies when automatic generation fails
   */
  private generateFallbackDependencies(
    questions: { id: number; questionText: string }[],
  ): Record<number, number[]> {
    const dependencies: Record<number, number[]> = {};

    // Simple strategy: questions might depend on earlier questions
    for (let index = 0; index < questions.length; index++) {
      const questionId = questions[index].id;

      // By default, no dependencies
      dependencies[questionId] = [];

      // Simple heuristic: look for references to earlier questions
      const questionText = questions[index].questionText.toLowerCase();

      for (let index_ = 0; index_ < index; index_++) {
        const earlierQuestionId = questions[index_].id;

        // Check for references like "question 1" or "previous question"
        if (
          questionText.includes(`question ${index_ + 1}`) ||
          (index === index_ + 1 && questionText.includes("previous question"))
        ) {
          dependencies[questionId].push(earlierQuestionId);
        }
      }
    }

    return dependencies;
  }
}
