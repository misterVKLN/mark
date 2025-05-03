/* eslint-disable unicorn/no-null */
import { HttpService } from "@nestjs/axios";
import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { TranslationService } from "./translation/translation.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "../common/utils/attempt-questions-mapper.util";
import { BaseAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { GRADE_SUBMISSION_EXCEPTION } from "src/api/assignment/attempt/api-exceptions/exceptions";
import { LearnerUpdateAssignmentAttemptRequestDto } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  GetAssignmentAttemptResponseDto,
  AssignmentAttemptQuestions,
} from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
import {
  AttemptQuestionDto,
  Choice,
  QuestionDto,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { AssignmentAttempt, Question } from "@prisma/client";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "src/api/assignment/dto/get.assignment.response.dto";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { AssignmentRepository } from "src/api/assignment/v2/repositories/assignment.repository";

@Injectable()
export class AttemptSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: AttemptValidationService,
    private readonly gradingService: AttemptGradingService,
    private assignmentRepository: AssignmentRepository,
    private readonly questionResponseService: QuestionResponseService,
    private readonly translationService: TranslationService,
    private readonly questionVariantService: QuestionVariantService,
    private readonly httpService: HttpService,
  ) {}
  /**
   * Creates a new assignment attempt
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    // Get the assignment
    const assignment = await this.assignmentRepository.findById(
      assignmentId,
      userSession,
    );

    // Validate the new attempt
    await this.validationService.validateNewAttempt(assignment, userSession);

    // Calculate attempt expiration time
    const attemptExpiresAt = this.calculateAttemptExpiresAt(assignment);

    // Create the base attempt record
    const assignmentAttempt = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId,
        grade: undefined,
        userId: userSession.userId,
        questionOrder: [],
      },
    });

    // Get the assignment questions
    const questions = (await this.prisma.question.findMany({
      where: {
        assignmentId,
        isDeleted: false,
      },
      include: {
        variants: {
          where: { isDeleted: false },
        },
      },
    })) as unknown as QuestionDto[];
    // Map questions to QuestionDto shape before ordering
    const questionDtos: QuestionDto[] = questions.map((q: QuestionDto) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      assignmentId: q.assignmentId,
      totalPoints: q.totalPoints,
      maxWords: q.maxWords || undefined,
      maxCharacters: q.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(q.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(q.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer: (() => {
        if (typeof q.answer === "boolean") {
          return q.answer;
        }
        if (q.answer === "true") {
          return true;
        }
        if (q.answer === "false") {
          return false;
        }
        return;
      })(),
      variants: q.variants,
      gradingContextQuestionIds: q.gradingContextQuestionIds || [],
      responseType: q.responseType || undefined,
      isDeleted: q.isDeleted,
      randomizedChoices:
        typeof q.randomizedChoices === "boolean"
          ? q.randomizedChoices
          : typeof q.randomizedChoices === "string"
            ? q.randomizedChoices === "true"
            : false,
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          q.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        q.liveRecordingConfig,
        null,
      ),
    }));
    // Set question order based on assignment settings
    const orderedQuestions = this.getOrderedQuestions(questionDtos, assignment);

    // Update the question order in the attempt
    await this.prisma.assignmentAttempt.update({
      where: { id: assignmentAttempt.id },
      data: {
        questionOrder: orderedQuestions.map((q) => q.id),
      },
    });

    // Create question variant mappings
    await this.questionVariantService.createAttemptQuestionVariants(
      assignmentAttempt.id,
      orderedQuestions,
    );

    return {
      id: assignmentAttempt.id,
      success: true,
    };
  }

  /**
   * Updates an assignment attempt
   */
  async updateAssignmentAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const { role, userId } = request.userSession;

    // For learner role, handle differently than author
    return role === UserRole.LEARNER
      ? this.updateLearnerAttempt(
          attemptId,
          assignmentId,
          updateDto,
          authCookie,
          gradingCallbackRequired,
          request,
        )
      : this.updateAuthorAttempt(assignmentId, updateDto);
  }
  /**
   * Gets a learner assignment attempt with all details needed for display
   */
  async getLearnerAssignmentAttempt(
    attemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    // Fetch assignment attempt with related data
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: { questionVariant: { include: { variantOf: true } } },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    // Fetch questions for this assignment
    const questions = await this.prisma.question.findMany({
      where: { assignmentId: assignmentAttempt.assignmentId },
    });

    // Fetch assignment with display settings
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }

    // Transform the questions into EnhancedAttemptQuestionDto objects
    const questionDtos: EnhancedAttemptQuestionDto[] = questions.map((q) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      assignmentId: q.assignmentId,
      totalPoints: q.totalPoints,
      maxWords: q.maxWords || undefined,
      maxCharacters: q.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(q.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(q.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer:
        typeof q.answer === "boolean"
          ? String(q.answer)
          : q.answer !== null && q.answer !== undefined
            ? String(q.answer)
            : undefined,
      gradingContextQuestionIds: q.gradingContextQuestionIds || [],
      responseType: q.responseType || undefined,
      isDeleted: q.isDeleted,
      randomizedChoices:
        typeof q.randomizedChoices === "string"
          ? q.randomizedChoices
          : JSON.stringify(q.randomizedChoices ?? false),
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          q.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        q.liveRecordingConfig,
        null,
      ),
    }));

    // Create a properly typed assignment attempt object for the mapper
    const formattedAttempt: AssignmentAttemptWithRelations = {
      ...assignmentAttempt,
      questionVariants: assignmentAttempt.questionVariants.map((qv) => ({
        questionId: qv.questionId,
        randomizedChoices:
          typeof qv.randomizedChoices === "string"
            ? qv.randomizedChoices
            : JSON.stringify(qv.randomizedChoices ?? false),
      })),
    };

    // Build the questions with responses using the mapper
    const finalQuestions =
      await AttemptQuestionsMapper.buildQuestionsWithResponses(
        formattedAttempt,
        questionDtos,
        {
          id: assignmentAttempt.assignmentId,
          ...assignment,
        },
        this.prisma,
        assignmentAttempt.preferredLanguage || undefined,
      );

    // Apply visibility settings based on assignment config
    this.applyVisibilitySettings(finalQuestions, assignmentAttempt, assignment);

    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      comments: assignmentAttempt.comments,
    };
  }

  /**
   * Gets an assignment attempt with language translation support
   */
  async getAssignmentAttempt(
    attemptId: number,
    language?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const normalizedLanguage = this.getNormalizedLanguage(language);

    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: {
            questionVariant: {
              include: {
                variantOf: true,
              },
            },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
      },
    });

    // Get translations for the questions and variants
    const translations =
      await this.translationService.getTranslationsForAttempt(
        assignmentAttempt,
        assignment.questions as unknown as QuestionDto[],
      );

    // Convert boolean answers to strings for questionVariants and their variantOf
    const formattedAttempt: AssignmentAttemptWithRelations = {
      ...assignmentAttempt,
      questionVariants: assignmentAttempt.questionVariants.map((qv) => ({
        ...qv,
        randomizedChoices:
          typeof qv.randomizedChoices === "string"
            ? qv.randomizedChoices
            : JSON.stringify(qv.randomizedChoices ?? false),
        questionVariant: {
          ...qv.questionVariant,
          answer:
            typeof qv?.questionVariant?.answer === "boolean"
              ? String(qv?.questionVariant?.answer)
              : qv?.questionVariant?.answer,
          variantOf: qv?.questionVariant?.variantOf
            ? {
                ...qv?.questionVariant?.variantOf,
                answer:
                  typeof qv?.questionVariant?.variantOf.answer === "boolean"
                    ? String(qv?.questionVariant?.variantOf.answer)
                    : qv?.questionVariant?.variantOf.answer,
              }
            : undefined,
        },
      })),
    };

    // Get questions with translated content
    const finalQuestions: AttemptQuestionDto[] =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        formattedAttempt,
        assignment as unknown as UpdateAssignmentQuestionsDto,
        translations,
        normalizedLanguage,
      );

    // Remove sensitive data before returning
    this.removeSensitiveData(finalQuestions);

    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
    };
  }

  // PRIVATE METHODS

  /**
   * Updates an attempt for a learner
   */
  private async updateLearnerAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        questionVariants: {
          select: {
            questionId: true,
            questionVariant: { include: { variantOf: true } },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    // Check if attempt is expired
    if (this.validationService.isAttemptExpired(assignmentAttempt.expiresAt)) {
      const expiredResult = await this.handleExpiredAttempt(attemptId);
      return expiredResult;
    }

    // Process and translate the questions if needed
    const preTranslatedQuestions =
      await this.translationService.preTranslateQuestions(
        updateDto.responsesForQuestions,
        assignmentAttempt,
        updateDto.language,
      );

    updateDto.preTranslatedQuestions = preTranslatedQuestions;

    // Get the assignment
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    // Submit and process question responses
    const successfulQuestionResponses =
      await this.questionResponseService.submitQuestions(
        updateDto.responsesForQuestions,
        attemptId,
        request.userSession.role,
        assignmentId,
        updateDto.language,
        updateDto.authorQuestions,
        updateDto.authorAssignmentDetails,
        updateDto.preTranslatedQuestions,
      );

    // Calculate the grade
    const { grade, totalPointsEarned, totalPossiblePoints } =
      this.gradingService.calculateGradeForLearner(
        successfulQuestionResponses,
        assignment,
      );

    // Send grade to LTI if required
    if (gradingCallbackRequired) {
      await this.handleLtiGradeCallback(
        grade,
        authCookie,
        assignmentId,
        request.userSession.userId,
      );
    }

    // Update the attempt in database
    const result = await this.updateAssignmentAttemptInDb(
      attemptId,
      updateDto,
      grade,
    );

    // Construct response with feedback based on assignment settings
    return {
      id: result.id,
      submitted: result.submitted,
      success: true,
      totalPointsEarned,
      totalPossiblePoints,
      grade: assignment.showAssignmentScore ? result.grade : undefined,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      feedbacksForQuestions: this.gradingService.constructFeedbacksForQuestions(
        successfulQuestionResponses,
        assignment,
      ),
    };
  }

  /**
   * Updates an attempt for an author (preview mode)
   */
  private async updateAuthorAttempt(
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    // Get the assignment
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    // Use a fake attempt ID for author preview
    const fakeAttemptId = -1;

    // Submit and process question responses
    const successfulQuestionResponses =
      await this.questionResponseService.submitQuestions(
        updateDto.responsesForQuestions,
        fakeAttemptId,
        UserRole.AUTHOR,
        assignmentId,
        updateDto.language,
        updateDto.authorQuestions,
        updateDto.authorAssignmentDetails,
      );

    // Calculate the grade
    const { grade, totalPointsEarned, totalPossiblePoints } =
      this.gradingService.calculateGradeForAuthor(
        successfulQuestionResponses,
        updateDto.authorQuestions,
      );

    // Return the simulated results without persisting to database
    return {
      id: -1,
      submitted: true,
      success: true,
      totalPointsEarned,
      totalPossiblePoints,
      grade: assignment.showAssignmentScore ? grade : undefined,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      feedbacksForQuestions: this.gradingService.constructFeedbacksForQuestions(
        successfulQuestionResponses,
        assignment,
      ),
    };
  }

  /**
   * Handle an expired attempt
   */
  private async handleExpiredAttempt(
    attemptId: number,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    await this.prisma.assignmentAttempt.update({
      where: { id: attemptId },
      data: {
        submitted: true,
        grade: 0,
        comments:
          "You submitted the assignment after the deadline. Your submission will not be graded. If you don't have any more attempts, please contact your instructor.",
      },
    });

    return {
      id: attemptId,
      submitted: true,
      success: true,
      totalPointsEarned: 0,
      totalPossiblePoints: 0,
      grade: 0,
      showSubmissionFeedback: false,
      feedbacksForQuestions: [],
      message: "The attempt deadline has passed.",
    };
  }

  /**
   * Handle the LTI grade callback
   */
  private async handleLtiGradeCallback(
    grade: number,
    authCookie: string,
    assignmentId: number,
    userId: string,
  ): Promise<void> {
    // Find the highest grade for this user and assignment
    const userAttempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId,
        assignmentId,
      },
      select: {
        grade: true,
      },
    });

    let highestOverall = 0;
    for (const attempt of userAttempts) {
      if (attempt.grade && attempt.grade > highestOverall) {
        highestOverall = attempt.grade;
      }
    }

    if (grade && grade > highestOverall) {
      highestOverall = grade;
    }

    // Send the grade to the LTI gateway
    await this.sendGradeToLtiGateway(highestOverall, authCookie);
  }

  /**
   * Update the assignment attempt in the database
   */
  private async updateAssignmentAttemptInDb(
    attemptId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    grade: number,
  ) {
    // Extract fields that should not be part of the update
    const {
      responsesForQuestions,
      authorQuestions,
      authorAssignmentDetails,
      language,
      preTranslatedQuestions,
      ...cleanedUpdateDto
    } = updateDto;

    return this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateDto,
        preferredLanguage: language ?? "en",
        expiresAt: new Date(),
        grade,
      },
      where: { id: attemptId },
    });
  }

  /**
   * Send a grade to the LTI gateway
   */
  private async sendGradeToLtiGateway(
    grade: number,
    authCookie: string,
  ): Promise<void> {
    try {
      const ltiGatewayResponse = await this.httpService
        .put(
          process.env.GRADING_LTI_GATEWAY_URL,
          { score: grade },
          {
            headers: {
              Cookie: `authentication=${authCookie}`,
            },
          },
        )
        .toPromise();

      if (ltiGatewayResponse.status !== 200) {
        throw new InternalServerErrorException(GRADE_SUBMISSION_EXCEPTION);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred while sending the grade to the LTI gateway.";
      throw new InternalServerErrorException(
        `${GRADE_SUBMISSION_EXCEPTION}: ${errorMessage}`,
      );
    }
  }

  /**
   * Calculate the expiration date for an attempt
   */
  private calculateAttemptExpiresAt(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
  ): Date | null {
    if (
      assignment.allotedTimeMinutes !== undefined &&
      assignment.allotedTimeMinutes > 0
    ) {
      return new Date(Date.now() + assignment.allotedTimeMinutes * 60 * 1000);
    }
    return undefined;
  }

  /**
   * Get ordered questions based on assignment settings
   */
  private getOrderedQuestions(
    questions: QuestionDto[],
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
  ): QuestionDto[] {
    const orderedQuestions = [...questions];

    if (assignment.displayOrder === "RANDOM") {
      orderedQuestions.sort(() => Math.random() - 0.5);
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      orderedQuestions.sort(
        (a, b) =>
          assignment.questionOrder.indexOf(a.id) -
          assignment.questionOrder.indexOf(b.id),
      );
    }

    // Map and parse JSON fields to match QuestionDto
    return orderedQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      assignmentId: q.assignmentId,
      totalPoints: q.totalPoints,
      maxWords: q.maxWords || undefined,
      maxCharacters: q.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(q.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(q.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer: (() => {
        if (typeof q.answer === "boolean") {
          return q.answer;
        }
        if (q.answer === "true") {
          return true;
        }
        if (q.answer === "false") {
          return false;
        }
        return;
      })(),
      variants: q.variants,
      gradingContextQuestionIds: q.gradingContextQuestionIds || [],
      responseType: q.responseType || undefined,
      isDeleted: q.isDeleted,
      randomizedChoices:
        typeof q.randomizedChoices === "boolean"
          ? q.randomizedChoices
          : typeof q.randomizedChoices === "string"
            ? q.randomizedChoices === "true"
            : false,
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          q.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        q.liveRecordingConfig,
        null,
      ),
    }));
  }

  /**
   * Applies visibility settings to questions according to the assignment configuration
   */
  private applyVisibilitySettings(
    questions: AssignmentAttemptQuestions[],
    assignmentAttempt: AssignmentAttempt,
    assignment: {
      showAssignmentScore?: boolean;
      showSubmissionFeedback?: boolean;
      showQuestionScore?: boolean;
    },
  ): void {
    // If assignment score should be hidden
    if (assignment.showAssignmentScore === false) {
      assignmentAttempt.grade = null;
    }

    // Apply visibility settings to each question
    for (const question of questions) {
      // Hide feedback if configured
      if (assignment.showSubmissionFeedback === false) {
        for (const response of question.questionResponses || []) {
          if (response.feedback) {
            response.feedback = null;
          }
        }
      }

      // Hide question scores if configured
      if (assignment.showQuestionScore === false) {
        for (const response of question.questionResponses || []) {
          if (response.points !== undefined) {
            response.points = -1;
          }
        }
      }
    }
  }

  /**
   * Remove sensitive data from questions
   */
  private removeSensitiveData(questions: AttemptQuestionDto[]): void {
    for (const question of questions) {
      if (!question.scoring?.showRubricsToLearner) {
        delete question.scoring?.rubrics;
      }

      if (question.choices) {
        for (const choice of question.choices) {
          delete choice.points;
          delete choice.isCorrect;
          delete choice.feedback;
        }
      }

      if (question.translations) {
        for (const lang in question.translations) {
          const translationObject = question.translations[lang];
          if (translationObject?.translatedChoices) {
            for (const choice of translationObject.translatedChoices) {
              delete choice.points;
              delete choice.isCorrect;
              delete choice.feedback;
            }
          }
        }
      }

      if (
        question.randomizedChoices &&
        typeof question.randomizedChoices === "string"
      ) {
        const randomizedArray = JSON.parse(
          question.randomizedChoices,
        ) as Array<{
          points?: number;
          isCorrect?: boolean;
          feedback?: string;
          [key: string]: any;
        }>;
        for (const choice of randomizedArray) {
          delete choice.points;
          delete choice.isCorrect;
          delete choice.feedback;
        }
        question.randomizedChoices = JSON.stringify(randomizedArray);
      }

      delete question.answer;
    }
  }

  /**
   * Safely parses a JSON value from various formats
   * @param value The value to parse (string, object, or null)
   * @param defaultValue Default value to return if parsing fails
   * @returns Parsed value as specified type T or the default value
   */
  private parseJsonValue<T>(value: unknown, defaultValue: T): T {
    // Handle null or undefined
    if (value === null || value === undefined) {
      return defaultValue;
    }

    // Parse string JSON
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    }

    // Return the value if it's already an object
    return value as T;
  }
  /**
   * Get normalized language code
   */
  private getNormalizedLanguage(language?: string): string {
    if (!language) {
      return "en";
    }
    return language.toLowerCase().split("-")[0];
  }
}
