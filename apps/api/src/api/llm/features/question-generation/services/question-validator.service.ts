/* eslint-disable unicorn/no-null */
// src/llm/features/question-generation/services/question-validator.service.ts
import { Injectable, Inject } from "@nestjs/common";
import { QuestionType, AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import { PROMPT_PROCESSOR } from "../../../llm.constants";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { EnhancedQuestionsToGenerate } from "src/api/assignment/dto/post.assignment.request.dto";
import { Criteria } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { DifficultyLevel } from "./question-generation.service";
import {
  Choice,
  QuestionDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { IQuestionValidatorService } from "../interfaces/question-validator.interface";

/**
 * Validation result for a batch of questions
 */
export interface ValidationResult {
  isValid: boolean;
  hasImprovements: boolean;
  issues: Record<number, string[]>; // Maps question index to array of issues
  improvements: Record<number, string>; // Maps question index to improvement suggestion
}

/**
 * Service that validates generated questions for quality assurance
 */
@Injectable()
export class QuestionValidatorService implements IQuestionValidatorService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: QuestionValidatorService.name,
    });
  }

  /**
   * Validate a batch of generated questions against requirements
   */
  async validateQuestions(
    questions: QuestionDto[],
    requirements: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
    content?: string,
    learningObjectives?: string,
  ): Promise<ValidationResult> {
    // ──────────────────────────── quick short-circuit ────────────────────────────
    if (!questions?.length) {
      return {
        isValid: false,
        hasImprovements: false,
        issues: { 0: ["No questions provided for validation"] },
        improvements: {},
      };
    }

    // ──────────────────────────── Zod output schema ──────────────────────────────
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        isValid: z.boolean(),
        questionIssues: z.record(z.string(), z.array(z.string())),
        improvementSuggestions: z.record(z.string(), z.string()),
        overallFeedback: z.string(),
      }),
    );
    const formatInstructions = parser.getFormatInstructions();

    // ──────────────────────────── prompt template ────────────────────────────────
    const template = `
  You are an expert assessment quality validator tasked with evaluating a set of generated questions against specific requirements.
  
  QUESTIONS TO VALIDATE:
  {questions}
  
  REQUIREMENTS:
  1. Correct Question Types and Counts:
     - MULTIPLE_CHOICE (SINGLE_CORRECT): {mc} questions
     - MULTIPLE_SELECT (MULTIPLE_CORRECT): {ms} questions
     - TEXT_RESPONSE: {txt} questions
     - TRUE_FALSE: {tf} questions
     - URL: {url} questions
     - UPLOAD: {upl} questions
     - LINK_FILE: {lf} questions
  
  2. Target Difficulty Level: {difficultyLevel}
  
  3. Content Alignment:
  {contentSection}
  {loSection}
  
  4. Question Type-Specific Quality Criteria:
    A. MULTIPLE_CHOICE …
    B. MULTIPLE_SELECT …
    C. TEXT_RESPONSE …
    D. TRUE_FALSE …
    E. URL/UPLOAD/LINK_FILE …
  
  5. General Quality Requirements:
     - No spelling/grammar errors
     - Appropriate language complexity for difficulty level
     - No ambiguity
     - Proper formatting
     - Complete information
  
  VALIDATION TASK:
  1. Analyse each question thoroughly
  2. Identify specific issues in each question
  3. Suggest concrete improvements for questions that need it
  4. Decide if the full set meets all requirements
  
  {format_instructions}
  `;

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        format_instructions: () => formatInstructions,
        questions: () => JSON.stringify(questions, null, 2),

        // counts
        mc: () => String(requirements.multipleChoice ?? 0),
        ms: () => String(requirements.multipleSelect ?? 0),
        txt: () => String(requirements.textResponse ?? 0),
        tf: () => String(requirements.trueFalse ?? 0),
        url: () => String(requirements.url ?? 0),
        upl: () => String(requirements.upload ?? 0),
        lf: () => String(requirements.linkFile ?? 0),

        difficultyLevel: () => difficultyLevel,

        // optional sections
        contentSection: () =>
          content
            ? `CONTENT:\n${content.slice(0, 500)}...\n`
            : "(no specific content provided)\n",

        loSection: () =>
          learningObjectives
            ? `LEARNING OBJECTIVES:\n${learningObjectives}\n`
            : "",
      },
    });

    // ──────────────────────────── LLM call & parsing ─────────────────────────────
    try {
      const response = await this.promptProcessor.processPrompt(
        prompt,
        Date.now(), // handy fallback ID
        AIUsageType.ASSIGNMENT_GENERATION,
      );

      const parsed = await parser.parse(response);

      return {
        isValid: parsed.isValid,
        hasImprovements: Object.keys(parsed.improvementSuggestions).length > 0,
        issues: this.convertStringKeysToNumbers(parsed.questionIssues),
        improvements: this.convertStringKeysToNumbers(
          parsed.improvementSuggestions,
        ),
      };
    } catch (error) {
      this.logger.error(
        `Error validating questions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // basic fallback
      return this.performBasicValidation(questions, requirements);
    }
  }

  /**
   * Helper to convert string keys to number keys
   */
  private convertStringKeysToNumbers<T>(
    object: Record<string, T>,
  ): Record<number, T> {
    const result: Record<number, T> = {};

    for (const [key, value] of Object.entries(object)) {
      const numberKey = Number.parseInt(key, 10);
      if (!Number.isNaN(numberKey)) {
        result[numberKey] = value;
      }
    }

    return result;
  }

  /**
   * Perform basic validation when LLM validation fails
   */
  private performBasicValidation(
    questions: QuestionDto[],
    requirements: EnhancedQuestionsToGenerate,
  ): ValidationResult {
    const issues: Record<number, string[]> = {};
    const improvements: Record<number, string> = {};

    // Count questions by type
    const countsByType: Record<string, number> = {};

    for (const [index, question] of questions.entries()) {
      const questionIssues: string[] = [];

      // Count by type
      countsByType[question.type] = (countsByType[question.type] || 0) + 1;

      // Basic validation by question type
      switch (question.type) {
        case QuestionType.SINGLE_CORRECT: {
          this.validateMultipleChoiceQuestion(question, questionIssues);
          break;
        }
        case QuestionType.MULTIPLE_CORRECT: {
          this.validateMultipleSelectQuestion(question, questionIssues);
          break;
        }
        case QuestionType.TEXT: {
          this.validateTextQuestion(question, questionIssues);
          break;
        }
        case QuestionType.TRUE_FALSE: {
          this.validateTrueFalseQuestion(question, questionIssues);
          break;
        }
        case QuestionType.URL:
        case QuestionType.UPLOAD:
        case QuestionType.LINK_FILE: {
          this.validateFileQuestion(question, questionIssues);
          break;
        }
      }

      // Add issues if any found
      if (questionIssues.length > 0) {
        issues[index] = questionIssues;
        improvements[index] =
          `Fix the following issues: ${questionIssues.join(", ")}`;
      }
    }

    // Check type counts against requirements
    const typeCountIssues: string[] = [];

    if (
      (countsByType[QuestionType.SINGLE_CORRECT] || 0) !==
      (requirements.multipleChoice || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.multipleChoice || 0} SINGLE_CORRECT questions, got ${countsByType[QuestionType.SINGLE_CORRECT] || 0}`,
      );
    }

    if (
      (countsByType[QuestionType.MULTIPLE_CORRECT] || 0) !==
      (requirements.multipleSelect || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.multipleSelect || 0} MULTIPLE_CORRECT questions, got ${countsByType[QuestionType.MULTIPLE_CORRECT] || 0}`,
      );
    }

    if (
      (countsByType[QuestionType.TEXT] || 0) !==
      (requirements.textResponse || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.textResponse || 0} TEXT questions, got ${countsByType[QuestionType.TEXT] || 0}`,
      );
    }

    if (
      (countsByType[QuestionType.TRUE_FALSE] || 0) !==
      (requirements.trueFalse || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.trueFalse || 0} TRUE_FALSE questions, got ${countsByType[QuestionType.TRUE_FALSE] || 0}`,
      );
    }

    if ((countsByType[QuestionType.URL] || 0) !== (requirements.url || 0)) {
      typeCountIssues.push(
        `Expected ${requirements.url || 0} URL questions, got ${countsByType[QuestionType.URL] || 0}`,
      );
    }

    if (
      (countsByType[QuestionType.UPLOAD] || 0) !== (requirements.upload || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.upload || 0} UPLOAD questions, got ${countsByType[QuestionType.UPLOAD] || 0}`,
      );
    }

    if (
      (countsByType[QuestionType.LINK_FILE] || 0) !==
      (requirements.linkFile || 0)
    ) {
      typeCountIssues.push(
        `Expected ${requirements.linkFile || 0} LINK_FILE questions, got ${countsByType[QuestionType.LINK_FILE] || 0}`,
      );
    }

    // If we have type count issues, add them to the general issues
    if (typeCountIssues.length > 0) {
      issues[-1] = typeCountIssues;
    }

    return {
      isValid: Object.keys(issues).length === 0,
      hasImprovements: Object.keys(improvements).length > 0,
      issues,
      improvements,
    };
  }

  /**
   * Validate a multiple choice question
   */
  private validateMultipleChoiceQuestion(
    question: QuestionDto,
    issues: string[],
  ): void {
    // Check for existence of choices
    if (!question.choices || !Array.isArray(question.choices)) {
      issues.push("Missing choices array");
      return;
    }

    // Check number of choices
    if (question.choices.length < 3) {
      issues.push("Multiple choice questions should have at least 3 choices");
    }

    // Check for exactly one correct answer
    const correctChoices = question.choices.filter((c: Choice) => c.isCorrect);
    if (correctChoices.length !== 1) {
      issues.push(
        `Single correct questions must have exactly one correct answer, found ${correctChoices.length}`,
      );
    }

    // Check for missing feedback
    const missingFeedback = question.choices.some(
      (c: Choice) => !c.feedback || c.feedback.length < 3,
    );
    if (missingFeedback) {
      issues.push("All choices should have meaningful feedback");
    }

    // Check for duplicate choices
    const choiceTexts = question.choices.map((c: Choice) =>
      c.choice?.toLowerCase().trim(),
    );
    if (new Set(choiceTexts).size !== choiceTexts.length) {
      issues.push("Choices contain duplicates");
    }
  }

  /**
   * Validate a multiple select question
   */
  private validateMultipleSelectQuestion(
    question: QuestionDto,
    issues: string[],
  ): void {
    // Check for existence of choices
    if (!question.choices || !Array.isArray(question.choices)) {
      issues.push("Missing choices array");
      return;
    }

    // Check number of choices
    if (question.choices.length < 3) {
      issues.push("Multiple select questions should have at least 3 choices");
    }

    // Check for at least one correct answer
    const correctChoices = question.choices.filter((c: Choice) => c.isCorrect);
    if (correctChoices.length === 0) {
      issues.push(
        "Multiple select questions must have at least one correct answer",
      );
    }

    // Check for missing feedback
    const missingFeedback = question.choices.some(
      (c: Choice) => !c.feedback || c.feedback.length < 3,
    );
    if (missingFeedback) {
      issues.push("All choices should have meaningful feedback");
    }

    // Check for duplicate choices
    const choiceTexts = question.choices.map((c: Choice) =>
      c.choice?.toLowerCase().trim(),
    );
    if (new Set(choiceTexts).size !== choiceTexts.length) {
      issues.push("Choices contain duplicates");
    }
  }

  /**
   * Validate a text question
   */
  private validateTextQuestion(question: QuestionDto, issues: string[]): void {
    // Check for word/character limits
    if (!question.maxWords && !question.maxCharacters) {
      issues.push(
        "Text questions should have either maxWords or maxCharacters limit",
      );
    }

    // Check for scoring rubric
    if (
      !question.scoring ||
      !question.scoring.rubrics ||
      !Array.isArray(question.scoring.rubrics) ||
      question.scoring.rubrics.length === 0
    ) {
      issues.push("Text questions must have scoring rubrics");
      return;
    }

    // Check each rubric
    for (const [index, rubric] of question.scoring.rubrics.entries()) {
      if (
        !rubric.criteria ||
        !Array.isArray(rubric.criteria) ||
        rubric.criteria.length < 2
      ) {
        issues.push(`Rubric ${index + 1} needs at least 2 criteria`);
      } else {
        const points = rubric.criteria.map((c: Criteria) => c.points);
        if (new Set(points).size !== points.length) {
          issues.push(
            `Criteria in rubric ${index + 1} should have unique point values`,
          );
        }
      }
    }
  }

  /**
   * Validate a true/false question
   */
  private validateTrueFalseQuestion(
    question: QuestionDto,
    issues: string[],
  ): void {
    // Check for choices
    if (!question.choices || !Array.isArray(question.choices)) {
      issues.push("Missing choices array");
      return;
    }

    // Check for exactly 1 choice
    if (question.choices.length !== 1) {
      issues.push("True/False questions must have exactly 1 choice");
      return;
    }

    const choice = question.choices[0];

    // Normalize the choice text to lowercase for case-insensitive comparison
    const choiceText = choice.choice?.toString().toLowerCase().trim();

    // Validate the choice text is either "true" or "false" (case-insensitive)
    if (choiceText !== "true" && choiceText !== "false") {
      issues.push(
        'True/False questions must have a choice with text "true" or "false"',
      );
    }

    // Check if isCorrect matches the choice value
    const isStatementTrue = choiceText === "true";
    if (choice.isCorrect !== isStatementTrue) {
      issues.push(
        `For TRUE/FALSE questions, isCorrect must match the choice value: if choice is "${choiceText}", isCorrect should be ${isStatementTrue.toString()}`,
      );
    }

    // Check for feedback
    if (!choice.feedback || choice.feedback.length < 5) {
      issues.push(
        "The choice must have meaningful feedback (at least 5 characters)",
      );
    }

    // Check for points allocation
    if (isStatementTrue && (!choice.points || choice.points <= 0)) {
      issues.push("A correct TRUE/FALSE choice should have positive points");
    }
  }

  /**
   * Validate a file-based question (URL, UPLOAD, LINK_FILE)
   */
  private validateFileQuestion(question: QuestionDto, issues: string[]): void {
    // Check for clear instructions
    if (question.question.length < 20) {
      issues.push(
        "File-based questions should have clear, detailed instructions",
      );
    }

    // Check for scoring rubric
    if (
      !question.scoring ||
      !question.scoring.rubrics ||
      !Array.isArray(question.scoring.rubrics) ||
      question.scoring.rubrics.length === 0
    ) {
      issues.push("File-based questions must have scoring rubrics");
      return;
    }

    // Check each rubric
    for (const [index, rubric] of question.scoring.rubrics.entries()) {
      if (
        !rubric.criteria ||
        !Array.isArray(rubric.criteria) ||
        rubric.criteria.length < 2
      ) {
        issues.push(`Rubric ${index + 1} needs at least 2 criteria`);
      } else {
        // Check for unique point values
        const points = rubric.criteria.map((c: Criteria) => c.points);
        if (new Set(points).size !== points.length) {
          issues.push(
            `Criteria in rubric ${index + 1} should have unique point values`,
          );
        }
      }
    }

    // Check for appropriate response type
    if (!question.responseType) {
      issues.push("File-based questions should have a specified responseType");
    }
  }
}
