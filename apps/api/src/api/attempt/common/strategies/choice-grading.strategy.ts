/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  CreateQuestionResponseAttemptResponseDto,
  ChoiceBasedFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import {
  QuestionDto,
  Choice,
} from "src/api/assignment/dto/update.questions.request.dto";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";

@Injectable()
export class ChoiceGradingStrategy extends AbstractGradingStrategy<string[]> {
  constructor(
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
  }

  /**
   * Handle both single-choice and multiple-choice questions
   */
  async handleResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    if (question.type === QuestionType.SINGLE_CORRECT) {
      return this.handleSingleChoice(question, requestDto, context);
    } else if (question.type === QuestionType.MULTIPLE_CORRECT) {
      return this.handleMultipleChoice(question, requestDto, context);
    } else {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "unsupportedChoiceType",
          context.language,
          { type: question.type },
        ),
      );
    }
  }

  /**
   * Validate response for choice-based questions
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    // For choice-based questions, we allow empty responses (no selection)
    // but we'll handle that in the grading logic
    if (
      question.type === QuestionType.SINGLE_CORRECT &&
      requestDto.learnerChoices &&
      requestDto.learnerChoices.length > 1
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "tooManyChoicesSelected",
          requestDto.language,
          { max: 1 },
        ),
      );
    }

    return true;
  }

  /**
   * Extract learner choices from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string[]> {
    return requestDto.learnerChoices || [];
  }

  /**
   * Implement the required gradeResponse method from the interface
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    if (question.type === QuestionType.SINGLE_CORRECT) {
      const result = await this.gradeSingleChoice(
        question,
        learnerResponse,
        context,
      );
      return result.responseDto;
    } else if (question.type === QuestionType.MULTIPLE_CORRECT) {
      const result = await this.gradeMultipleChoice(
        question,
        learnerResponse,
        context,
      );
      return result.responseDto;
    } else {
      throw new BadRequestException(
        `Unsupported choice question type: ${question.type}`,
      );
    }
  }

  /**
   * Handle single choice questions
   */
  private async handleSingleChoice(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    // Validate the response
    await this.validateResponse(question, requestDto);

    // Extract the learner response
    const learnerResponse = await this.extractLearnerResponse(requestDto);

    // Grade the response
    return this.gradeSingleChoice(question, learnerResponse, context);
  }

  /**
   * Grade a single choice question
   */
  private async gradeSingleChoice(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    const choices = this.parseChoices(question.choices);

    // No selection case
    if (!learnerResponse || learnerResponse.length === 0) {
      const responseDto = this.createResponseDto(0, [
        {
          choice: "",
          feedback: this.localizationService.getLocalizedString(
            "noOptionSelected",
            context.language,
          ),
        } as ChoiceBasedFeedbackDto,
      ]);

      return { responseDto, learnerResponse: [] };
    }

    const learnerChoice = learnerResponse[0];
    const normalizedLearnerChoice = this.normalizeText(learnerChoice);
    const correctChoice = choices.find((choice) => choice.isCorrect);

    // Find the selected choice
    const selectedChoice = choices.find(
      (choice) => this.normalizeText(choice.choice) === normalizedLearnerChoice,
    );

    const data = {
      learnerChoice,
      correctChoice: correctChoice?.choice,
      points: selectedChoice ? selectedChoice.points : 0,
    };

    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (selectedChoice) {
      // Apply feedback based on selection
      let choiceFeedback = "";
      if (selectedChoice.feedback) {
        choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
      } else {
        choiceFeedback = selectedChoice.isCorrect
          ? this.localizationService.getLocalizedString(
              "correctSelection",
              context.language,
              data,
            )
          : this.localizationService.getLocalizedString(
              "incorrectSelection",
              context.language,
              data,
            );
      }

      responseDto.totalPoints = selectedChoice.isCorrect
        ? selectedChoice.points
        : 0;

      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: choiceFeedback,
        },
      ] as ChoiceBasedFeedbackDto[];

      // Add detailed grading information for auditing
      responseDto.metadata = {
        isCorrect: selectedChoice.isCorrect,
        correctChoice: correctChoice?.choice,
        possiblePoints: selectedChoice.points,
        scoredPoints: responseDto.totalPoints,
      };
    } else {
      // Invalid selection
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        },
      ] as ChoiceBasedFeedbackDto[];

      // Add metadata about the invalid selection
      responseDto.metadata = {
        isCorrect: false,
        error: "invalidSelection",
        correctChoice: correctChoice?.choice,
      };
    }

    return { responseDto, learnerResponse };
  }

  /**
   * Handle multiple choice questions
   */
  private async handleMultipleChoice(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    // Validate the response
    await this.validateResponse(question, requestDto);

    // Extract the learner response
    const learnerResponse = await this.extractLearnerResponse(requestDto);

    // Grade the response
    return this.gradeMultipleChoice(question, learnerResponse, context);
  }

  /**
   * Grade a multiple choice question
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async gradeMultipleChoice(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    // Check if any choices were selected
    if (!learnerResponse || learnerResponse.length === 0) {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: [],
          feedback: this.localizationService.getLocalizedString(
            "noOptionSelected",
            context.language,
          ),
        },
      ] as unknown as ChoiceBasedFeedbackDto[];

      return { responseDto, learnerResponse: [] };
    }

    // Normalize chosen options for comparison
    const normalizedLearnerChoices = new Set(
      learnerResponse.map((choice) => this.normalizeText(choice)),
    );

    // Parse and normalize question choices
    const choices = this.parseChoices(question.choices);
    const normalizedChoices = choices.map((choice) => ({
      original: choice,
      normalized: this.normalizeText(choice.choice),
    }));

    // Get all correct choices
    const correctChoices = choices.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) =>
      this.normalizeText(choice.choice),
    );

    // Process feedback for each learner choice
    let totalPoints = 0;
    const feedbackDetails: string[] = [];
    const selectedChoices: Choice[] = [];

    for (const learnerChoice of learnerResponse) {
      const normalizedLearnerChoice = this.normalizeText(learnerChoice);
      const matchedChoice = normalizedChoices.find(
        (item) => item.normalized === normalizedLearnerChoice,
      );

      if (matchedChoice) {
        // Track selected choices
        selectedChoices.push({
          choice: matchedChoice.original.choice,
          isCorrect: matchedChoice.original.isCorrect,
          points: matchedChoice.original.points || 0,
          feedback: matchedChoice.original.feedback,
        });

        // Award points for correct choices
        if (matchedChoice.original.isCorrect) {
          totalPoints += matchedChoice.original.points || 0;
        } else if (question.scoring?.type === ScoringType.LOSS_PER_MISTAKE) {
          totalPoints -= matchedChoice.original.points || 0;
        }

        const data = {
          learnerChoice,
          points: matchedChoice.original.points || 0,
        };

        // Generate feedback
        let choiceFeedback = "";
        if (matchedChoice.original.feedback) {
          choiceFeedback = this.formatFeedback(
            matchedChoice.original.feedback,
            data,
          );
        } else {
          choiceFeedback = matchedChoice.original.isCorrect
            ? this.localizationService.getLocalizedString(
                "correctSelection",
                context.language,
                data,
              )
            : this.localizationService.getLocalizedString(
                "incorrectSelection",
                context.language,
                data,
              );
        }

        feedbackDetails.push(choiceFeedback);
      } else {
        // Handle invalid choice
        selectedChoices.push({
          choice: learnerChoice,
          isCorrect: false,
          points: 0,
          feedback: this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        });

        feedbackDetails.push(
          this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        );
      }
    }

    // Calculate final score
    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + (choice.points || 0),
      0,
    );

    // Ensure score is not negative and does not exceed max points
    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));

    // Check if all correct options were selected (and no incorrect ones)
    const allCorrectSelected: boolean = correctChoiceTexts.every(
      (correctText) => normalizedLearnerChoices.has(correctText),
    );

    const noIncorrectSelected: boolean = [...normalizedLearnerChoices].every(
      (learnerChoice: string) => correctChoiceTexts.includes(learnerChoice),
    );

    const perfectScore: boolean = allCorrectSelected && noIncorrectSelected;

    // Construct final feedback message
    const feedbackMessage = `
      ${feedbackDetails.join(".\n")}.
      ${
        perfectScore
          ? this.localizationService.getLocalizedString(
              "allCorrectSelected",
              context.language,
            )
          : this.localizationService.getLocalizedString(
              "correctOptions",
              context.language,
              {
                correctOptions: correctChoices
                  .map((choice) => choice.choice)
                  .join(", "),
              },
            )
      }
    `;

    responseDto.totalPoints = finalPoints;
    responseDto.feedback = [
      {
        choice: learnerResponse.join(", "),
        feedback: feedbackMessage.trim(),
      },
    ];

    // Add metadata for auditing
    responseDto.metadata = {
      selectedChoices,
      correctChoices: correctChoices.map((c) => c.choice),
      maxPoints,
      actualPoints: totalPoints,
      finalPoints, // After capping to min 0, max maxPoints
      perfectScore,
      allCorrectSelected,
      noIncorrectSelected,
    };

    return { responseDto, learnerResponse };
  }

  /**
   * Parse choices from any format into an array of Choice objects
   */
  private parseChoices(choices: unknown): Choice[] {
    if (!choices) {
      return [];
    }

    if (typeof choices === "string") {
      try {
        return JSON.parse(choices) as Choice[];
      } catch {
        return [];
      }
    }

    return choices as Choice[];
  }

  /**
   * Normalize text for comparison (lowercase, trim, remove punctuation)
   */
  private normalizeText(text: string): string {
    return (
      text
        .trim()
        .toLowerCase()
        // Remove common punctuation that might differ in translations
        .replaceAll(/[!,.،؛؟]/g, "")
    );
  }

  /**
   * Format a feedback string with placeholder replacements
   */
  private formatFeedback(
    feedbackTemplate: string,
    data: { [key: string]: any },
  ): string {
    return feedbackTemplate.replaceAll(/\${(.*?)}/g, (_, g: string) =>
      String(data[g] || ""),
    );
  }
}
