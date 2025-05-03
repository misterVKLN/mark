import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import { ResponseType } from "@prisma/client";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/prisma.service";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  EnhancedQuestionsToGenerate,
  QuestionGenerationPayload,
} from "../../dto/post.assignment.request.dto";
import {
  QuestionDto,
  GenerateQuestionVariantDto,
  VariantDto,
  VariantType,
  Choice,
} from "../../dto/update.questions.request.dto";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";
import { JobStatusServiceV2 } from "./job-status.service";
import { TranslationService } from "./translation.service";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
@Injectable()
export class QuestionService {
  private readonly logger = new Logger(QuestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionRepository: QuestionRepository,
    private readonly variantRepository: VariantRepository,
    private readonly translationService: TranslationService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV2,
  ) {}

  async getQuestionsForAssignment(
    assignmentId: number,
  ): Promise<QuestionDto[]> {
    return this.questionRepository.findByAssignmentId(assignmentId);
  }

  async generateQuestionVariants(
    assignmentId: number,
    generateVariantDto: GenerateQuestionVariantDto,
  ): Promise<BaseAssignmentResponseDto & { questions?: QuestionDto[] }> {
    const { questions, questionVariationNumber } = generateVariantDto;

    // Process all questions in parallel
    await Promise.all(
      questions.map(async (question) => {
        // Initialize variants array if it doesn't exist
        if (question.variants === undefined) {
          question.variants = [];
        }

        // Determine how many variants we need to generate
        const requiredVariants = this.calculateRequiredVariants(
          questions.length,
          question.variants.length,
          questionVariationNumber,
        );

        if (requiredVariants <= 0) return;

        // Generate the variants
        const newVariants = await this.generateVariantsFromQuestion(
          question,
          requiredVariants,
        );

        // Add the variants to the question
        this.addVariantsToQuestion(question, newVariants);
      }),
    );

    return {
      id: assignmentId,
      success: true,
      questions,
    };
  }

  /**
   * Process questions for publishing with detailed progress tracking
   *
   * @param assignmentId - The assignment ID
   * @param questions - Array of questions to process
   * @param jobId - Optional job ID for progress tracking
   */
  async processQuestionsForPublishing(
    assignmentId: number,
    questions: QuestionDto[],
    jobId?: number,
    forceTranslation = false,
  ): Promise<void> {
    // Report progress if we have a job ID
    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Retrieving existing questions",
        percentage: 21,
      });
    }

    // 1. Get existing questions to compare and determine what to delete
    const existingQuestions =
      await this.questionRepository.findByAssignmentId(assignmentId);

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Analyzing question changes",
        percentage: 22,
      });
    }

    // 2. Map of frontend IDs to backend IDs for tracking
    const frontendToBackendIdMap = new Map<number, number>();

    // 3. Identify questions to delete (existingQuestions not in new questions)
    const newQuestionIds = new Set(questions.map((q) => q.id));
    const questionsToDelete = existingQuestions.filter(
      (q) => !newQuestionIds.has(q.id),
    );

    // 4. Mark questions for deletion
    if (questionsToDelete.length > 0) {
      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Removing ${questionsToDelete.length} questions`,
          percentage: 24,
        });
      }

      await this.questionRepository.markAsDeleted(
        questionsToDelete.map((q) => q.id),
      );
    }

    // 5. Calculate progress increments for questions
    const totalQuestions = questions.length;
    const progressPerQuestion = totalQuestions > 0 ? 35 / totalQuestions : 0; // Progress range from 25% to 60%
    let currentProgress = 25;

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Processing ${totalQuestions} questions`,
        percentage: currentProgress,
      });
    }

    // 6. Process each question (create, update, handle variants)
    for (const [index, questionDto] of questions.entries()) {
      // Create a map to track questions that need translation
      const contentChanged = new Map<number, boolean>();

      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Processing question ${index + 1} of ${totalQuestions}`,
          percentage: Math.floor(currentProgress),
        });
      }

      // Use the backend ID if available
      const backendId =
        frontendToBackendIdMap.get(questionDto.id) || questionDto.id;
      const existingQuestion = existingQuestions.find(
        (q) => q.id === backendId,
      );

      // Check if content has changed to determine if translation is needed
      const questionContentChanged =
        forceTranslation ||
        !existingQuestion ||
        existingQuestion.question !== questionDto.question ||
        !this.areChoicesEqual(existingQuestion.choices, questionDto.choices);

      contentChanged.set(questionDto.id, questionContentChanged);

      // Apply guardrails if the question text has changed
      if (
        existingQuestion &&
        existingQuestion.question !== questionDto.question
      ) {
        if (jobId) {
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Validating question ${index + 1} content`,
            percentage: Math.floor(currentProgress),
          });
        }

        await this.applyGuardRails(questionDto);
      }

      // Upsert the question
      const upsertedQuestion = await this.questionRepository.upsert({
        id: existingQuestion ? existingQuestion.id : questionDto.id,
        assignmentId,
        question: questionDto.question,
        type: questionDto.type,
        answer: questionDto.answer ?? false,
        totalPoints: questionDto.totalPoints ?? 0,
        choices: questionDto.choices,
        scoring: questionDto.scoring,
        maxWords: questionDto.maxWords,
        maxCharacters: questionDto.maxCharacters,
        responseType: questionDto.responseType,
        randomizedChoices: questionDto.randomizedChoices,
        liveRecordingConfig: questionDto.liveRecordingConfig,
        videoPresentationConfig: questionDto.videoPresentationConfig,
        gradingContextQuestionIds: questionDto.gradingContextQuestionIds,
      });

      // Track the backend ID
      if (!existingQuestion) {
        frontendToBackendIdMap.set(questionDto.id, upsertedQuestion.id);
      }

      // Handle translations for the question ONLY if content has changed or force translation is set
      if (jobId && (questionContentChanged || forceTranslation)) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Translating question ${index + 1}`,
          percentage: Math.floor(currentProgress + progressPerQuestion * 0.5),
        });

        await this.translationService.translateQuestion(
          assignmentId,
          upsertedQuestion.id,
          questionDto,
          jobId,
        );
      } else if (jobId) {
        // Skip translation but update progress
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Question ${index + 1} content unchanged, skipping translation`,
          percentage: Math.floor(currentProgress + progressPerQuestion * 0.5),
        });
      }

      // Check variant content changes
      const checkVariantsChanged = this.checkVariantsForChanges(
        existingQuestion?.variants || [],
        questionDto.variants || [],
      );

      // Process variants
      const variantCount = questionDto.variants?.length || 0;
      if (variantCount > 0 && jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: checkVariantsChanged
            ? `Processing ${variantCount} variants for question ${index + 1} - content changes detected`
            : `Processing ${variantCount} variants for question ${index + 1} - metadata only`,
          percentage: Math.floor(currentProgress + progressPerQuestion * 0.7),
        });
      }

      await this.processVariantsForQuestion(
        assignmentId,
        upsertedQuestion.id,
        questionDto.variants || [],
        existingQuestion?.variants || [],
        jobId,
        checkVariantsChanged || forceTranslation,
      );

      // Update progress after processing this question
      currentProgress += progressPerQuestion;
    }

    // Final update for question processing
    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Question processing completed",
        percentage: 60,
      });
    }

    return;
  }

  /**
   * Check if choices are equal
   */
  private areChoicesEqual(choices1?: Choice[], choices2?: Choice[]): boolean {
    if (!choices1 && !choices2) return true;
    if (!choices1 || !choices2) return false;
    if (choices1.length !== choices2.length) return false;
    const sortedChoices1 = [...choices1].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    const sortedChoices2 = [...choices2].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    for (const [index, c1] of sortedChoices1.entries()) {
      const c2 = sortedChoices2[index];

      if (
        c1.choice !== c2.choice ||
        c1.feedback !== c2.feedback ||
        c1.isCorrect !== c2.isCorrect
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if any variants have changed
   */
  private checkVariantsForChanges(
    existingVariants: VariantDto[],
    newVariants: VariantDto[],
  ): boolean {
    if (existingVariants.length !== newVariants.length) {
      return true;
    }
    const existingVariantsMap = new Map<number, VariantDto>();
    for (const v of existingVariants) existingVariantsMap.set(v.id, v);
    for (const newVariant of newVariants) {
      const existingVariant = existingVariantsMap.get(newVariant.id);
      if (
        !existingVariant ||
        existingVariant.variantContent !== newVariant.variantContent ||
        !this.areChoicesEqual(existingVariant.choices, newVariant.choices)
      ) {
        return true;
      }
    }
    return false;
  }

  async generateQuestions(
    assignmentId: number,
    payload: QuestionGenerationPayload,
    userId: string,
  ): Promise<{ message: string; jobId: number }> {
    // Validate the payload
    this.validateQuestionGenerationPayload(payload);

    // Create a job for tracking
    const job = await this.jobStatusService.createJob(assignmentId, userId);

    // Start the question generation process asynchronously
    this.startQuestionGenerationProcess(
      assignmentId,
      job.id,
      payload.assignmentType,
      payload.questionsToGenerate,
      payload.fileContents,
      payload.learningObjectives,
    ).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Question generation failed: ${errorMessage}`,
        errorStack,
      );
    });

    return { message: "Question generation started", jobId: job.id };
  }

  async updateQuestionGradingContext(assignmentId: number): Promise<void> {
    // 1. Get the assignment with its questions
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found`,
      );
    }

    // 2. Get the question order
    const questionOrder = assignment.questionOrder || [];

    // 3. Sort questions based on the order
    const sortedQuestions = [...assignment.questions].sort(
      (a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id),
    );

    // 4. Map questions to format expected by LLM service
    const questionsForGradingContext = sortedQuestions.map((q) => ({
      id: q.id,
      questionText: q.question,
    }));

    // 5. Generate grading context mapping
    const gradingContextMap =
      await this.llmFacadeService.generateQuestionGradingContext(
        questionsForGradingContext,
        assignmentId,
      );

    // 6. Update each question with its grading context
    const updates = Object.entries(gradingContextMap).map(
      ([questionId, contextIds]) =>
        this.prisma.question.update({
          where: { id: Number(questionId) },
          data: { gradingContextQuestionIds: contextIds },
        }),
    );

    await Promise.all(updates);
  }
  private async startQuestionGenerationProcess(
    assignmentId: number,
    jobId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    files?: { filename: string; content: string }[],
    learningObjectives?: string,
  ): Promise<void> {
    try {
      let content = "";

      // Process files if provided
      if (files && files.length > 0) {
        // Update job status
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Mark is organizing the notes merging file contents.",
        });

        // Merge file contents
        content = files.map((file) => file.content).join("\n");

        // Sanitize content
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Mark is proofreading the content sanitizing material.",
        });

        content = this.llmFacadeService.sanitizeContent(content);
      }

      // Generate questions
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Mark is thinking generating questions.",
      });

      const llmResponse = await this.llmFacadeService.processMergedContent(
        assignmentId,
        assignmentType,
        questionsToGenerate,
        content,
        learningObjectives,
      );

      // Update job with generated questions
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress:
          "Mark has prepared the questions. Job completed successfully.",
        result: llmResponse,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error processing job ID ${jobId}: ${errorMessage}`,
        errorStack,
      );

      // Update job status to Failed
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Failed",
        progress: "Mark hit a snag, we are sorry for the inconvenience",
      });
    }
  }

  private validateQuestionGenerationPayload(
    payload: QuestionGenerationPayload,
  ): void {
    const {
      fileContents,
      learningObjectives,
      questionsToGenerate,
      assignmentId,
    } = payload;

    // Check either file contents or learning objectives are provided
    if (!fileContents && !learningObjectives) {
      throw new BadRequestException(
        "Either file contents or learning objectives are required",
      );
    }

    // Validate assignment ID
    if (Number.isNaN(assignmentId)) {
      throw new BadRequestException("Invalid assignment ID");
    }

    // Validate questions to generate
    const totalQuestions =
      (questionsToGenerate.multipleChoice || 0) +
      (questionsToGenerate.multipleSelect || 0) +
      (questionsToGenerate.textResponse || 0) +
      (questionsToGenerate.trueFalse || 0) +
      (questionsToGenerate.url || 0) +
      (questionsToGenerate.upload || 0) +
      (questionsToGenerate.linkFile || 0);

    if (totalQuestions <= 0) {
      throw new BadRequestException(
        "At least one question type must be selected with a count greater than 0",
      );
    }

    // Ensure response types are provided for advanced question types
    if (
      (questionsToGenerate.url > 0 ||
        questionsToGenerate.upload > 0 ||
        questionsToGenerate.linkFile > 0) &&
      !questionsToGenerate.responseTypes
    ) {
      // Add default response types
      questionsToGenerate.responseTypes = {
        TEXT: [ResponseType.OTHER],
        URL: [ResponseType.OTHER],
        UPLOAD: [ResponseType.OTHER],
        LINK_FILE: [ResponseType.OTHER],
      };
    }
  }

  /**
   * Process variants for a question with conditional translation
   *
   * @param assignmentId - The assignment ID
   * @param questionId - The question ID
   * @param variants - The array of variants to process
   * @param existingVariants - Existing variants for comparison
   * @param jobId - Optional job ID for progress tracking
   * @param forceTranslation - Force translation even if content hasn't changed
   */
  private async processVariantsForQuestion(
    assignmentId: number,
    questionId: number,
    variants: VariantDto[],
    existingVariants: VariantDto[],
    jobId?: number,
    forceTranslation = false,
  ): Promise<void> {
    // Create a map of existing variants by content for quick lookup
    const existingVariantsMap = new Map<string, VariantDto>();
    const existingVariantsIdMap = new Map<number, VariantDto>();

    for (const v of existingVariants) {
      existingVariantsMap.set(v.variantContent, v);
      existingVariantsIdMap.set(v.id, v);
    }

    // Identify variants to delete (existingVariants not in new variants)
    const newVariantContents = new Set(variants.map((v) => v.variantContent));
    const variantsToDelete = existingVariants.filter(
      (v) => !newVariantContents.has(v.variantContent),
    );

    // Mark variants for deletion
    if (variantsToDelete.length > 0 && jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Removing ${variantsToDelete.length} variants for question #${questionId}`,
      });

      await this.variantRepository.markAsDeleted(
        variantsToDelete.map((v) => v.id),
      );
    }

    // Calculate progress increments for variants
    const totalVariants = variants.length;

    // Process each variant (create or update)
    for (const [index, variantDto] of variants.entries()) {
      const existingVariant =
        existingVariantsMap.get(variantDto.variantContent) ||
        existingVariantsIdMap.get(variantDto.id);

      // Check if content has changed or is new
      const contentChanged =
        forceTranslation ||
        !existingVariant ||
        existingVariant.variantContent !== variantDto.variantContent ||
        !this.areChoicesEqual(existingVariant.choices, variantDto.choices);

      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: contentChanged
            ? `Processing variant ${index + 1}/${totalVariants} for question #${questionId} - content changes detected`
            : `Processing variant ${index + 1}/${totalVariants} for question #${questionId} - metadata only`,
        });
      }

      // Prepare variant data for upsert
      const variantData = {
        variantContent: variantDto.variantContent,
        choices: variantDto.choices,
        scoring: variantDto.scoring,
        maxWords: variantDto.maxWords,
        maxCharacters: variantDto.maxCharacters,
        randomizedChoices: variantDto.randomizedChoices,
        variantType: variantDto.variantType,
        questionId: questionId,
        id: variantDto.id,
      };

      if (existingVariant) {
        // Update existing variant
        const updatedVariant = await this.variantRepository.update(
          existingVariant.id,
          variantData,
        );

        // Handle translations ONLY if content has changed or force translation is set
        if (jobId && contentChanged) {
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Translating variant ${index + 1}/${totalVariants} for question #${questionId}`,
          });

          await this.translationService.translateVariant(
            assignmentId,
            questionId,
            updatedVariant.id,
            updatedVariant as unknown as VariantDto,
            jobId,
          );
        } else if (jobId) {
          // Skip translation but update progress
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Variant ${index + 1}/${totalVariants} unchanged, skipping translation`,
          });
        }
      } else {
        // Create new variant
        const newVariant = await this.variantRepository.create(variantData);

        // Always translate new variants
        if (jobId) {
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Translating new variant ${index + 1}/${totalVariants} for question #${questionId}`,
          });

          await this.translationService.translateVariant(
            assignmentId,
            questionId,
            newVariant.id,
            newVariant as unknown as VariantDto,
            jobId,
          );
        }
      }
    }
  }

  private async generateVariantsFromQuestion(
    question: QuestionDto,
    numberOfVariants: number,
  ): Promise<VariantDto[]> {
    try {
      if (!question) {
        throw new BadRequestException("Question not provided");
      }

      // Generate variants using LLM service
      const variants = await this.llmFacadeService.generateQuestionRewordings(
        question.question,
        numberOfVariants,
        question.type,
        question.assignmentId,
        question.choices,
        question.variants,
      );

      // Transform to VariantDto format
      return variants.map((variant) => ({
        id: variant.id,
        questionId: question.id,
        variantContent: variant.variantContent,
        choices: variant.choices,
        maxWords: question.maxWords,
        scoring: question.scoring,
        answer: question.answer,
        maxCharacters: question.maxCharacters,
        createdAt: new Date(),
        variantType: VariantType.REWORDED,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error generating variants: ${errorMessage}`,
        errorStack,
      );
      throw new BadRequestException("Failed to generate question variants");
    }
  }

  private addVariantsToQuestion(
    question: QuestionDto,
    newVariants: VariantDto[],
  ): void {
    if (!Array.isArray(question.variants)) {
      question.variants = [];
    }

    let variantId = question.variants.length + 1;

    for (const variant of newVariants) {
      question.variants.push({
        ...variant,
        id: Number(`${question.id}${variantId++}`),
        choices: variant.choices,
        scoring: variant.scoring,
        variantType: variant.variantType,
        randomizedChoices: true,
      });
    }
  }

  private calculateRequiredVariants(
    totalQuestions: number,
    currentVariants: number,
    targetVariants: number,
  ): number {
    return totalQuestions > 1
      ? Math.max(0, targetVariants - currentVariants)
      : targetVariants;
  }

  private async applyGuardRails(question: QuestionDto): Promise<void> {
    const isValid = await this.llmFacadeService.applyGuardRails(
      JSON.stringify(question),
    );

    if (!isValid) {
      throw new BadRequestException(
        "Question validation failed due to inappropriate or unacceptable content",
      );
    }
  }
}
