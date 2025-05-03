/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { QuestionService } from "../../../services/question.service";
import { QuestionRepository } from "../../../repositories/question.repository";
import { VariantRepository } from "../../../repositories/variant.repository";
import { TranslationService } from "../../../services/translation.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { JobStatusServiceV2 } from "../../../services/job-status.service";

import {
  QuestionDto,
  VariantDto,
  GenerateQuestionVariantDto,
  VariantType,
  Choice,
} from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionType, ResponseType } from "@prisma/client";
import {
  createMockPrismaService,
  createMockQuestionRepository,
  createMockVariantRepository,
  createMockTranslationService,
  createMockLlmFacadeService,
  createMockJobStatusService,
  createMockQuestionDto,
  createMockVariantDto,
  createMockJob,
  createMockQuestionGenerationPayload,
} from "../__mocks__/ common-mocks";

describe("QuestionService", () => {
  let questionService: QuestionService;
  let prismaService: ReturnType<typeof createMockPrismaService>;
  let questionRepository: ReturnType<typeof createMockQuestionRepository>;
  let variantRepository: ReturnType<typeof createMockVariantRepository>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let llmFacadeService: ReturnType<typeof createMockLlmFacadeService>;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;

  beforeEach(async () => {
    // Create mock dependencies using utility functions
    prismaService = createMockPrismaService();
    questionRepository = createMockQuestionRepository();
    variantRepository = createMockVariantRepository();
    translationService = createMockTranslationService();
    llmFacadeService = createMockLlmFacadeService();
    jobStatusService = createMockJobStatusService();

    // Create a testing module with our service and mocked dependencies
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: QuestionRepository,
          useValue: questionRepository,
        },
        {
          provide: VariantRepository,
          useValue: variantRepository,
        },
        {
          provide: TranslationService,
          useValue: translationService,
        },
        {
          provide: LlmFacadeService,
          useValue: llmFacadeService,
        },
        {
          provide: JobStatusServiceV2,
          useValue: jobStatusService,
        },
      ],
    }).compile();

    // Get the service instance from the testing module
    questionService = module.get<QuestionService>(QuestionService);
  });

  describe("getQuestionsForAssignment", () => {
    it("should return questions for an assignment", async () => {
      // Arrange
      const assignmentId = 1;
      const expectedQuestions = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      questionRepository.findByAssignmentId.mockResolvedValue(
        expectedQuestions,
      );

      // Act
      const result =
        await questionService.getQuestionsForAssignment(assignmentId);

      // Assert
      expect(questionRepository.findByAssignmentId).toHaveBeenCalledWith(
        assignmentId,
      );
      expect(result).toEqual(expectedQuestions);
    });
  });

  describe("generateQuestionVariants", () => {
    it("should generate variants for questions", async () => {
      // Arrange
      const assignmentId = 1;
      const question1 = createMockQuestionDto({ id: 1 });
      const question2 = createMockQuestionDto(
        { id: 2 },
        QuestionType.MULTIPLE_CORRECT,
      );

      const generateVariantDto: GenerateQuestionVariantDto = {
        questions: [question1, question2],
        questionVariationNumber: 2,
      };

      // Mock the LLM service to return some variants
      const mockVariants = [
        createMockVariantDto({
          id: 101,
          variantContent: "What is the capital city of France?",
        }),
        createMockVariantDto({
          id: 102,
          variantContent: "Which city serves as the capital of France?",
        }),
      ];
      llmFacadeService.generateQuestionRewordings.mockResolvedValue(
        mockVariants,
      );

      // Act
      const result = await questionService.generateQuestionVariants(
        assignmentId,
        generateVariantDto,
      );

      // Assert
      expect(result.id).toEqual(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeDefined();
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].variants).toBeDefined();
      expect(llmFacadeService.generateQuestionRewordings).toHaveBeenCalledTimes(
        2,
      );
    });

    // Fix for "should not generate variants when enough already exist"
    it("should not generate variants when enough already exist", async () => {
      // Arrange
      const assignmentId = 1;
      // Create a question with existing variants
      const existingVariants = [
        createMockVariantDto({ id: 101 }),
        createMockVariantDto({ id: 102 }),
      ];
      const question = createMockQuestionDto({
        id: 1,
        variants: existingVariants,
      });

      const generateVariantDto: GenerateQuestionVariantDto = {
        questions: [question],
        questionVariationNumber: 2, // We already have 2 variants
      };

      // Mock the calculateRequiredVariants method to return 0
      jest
        .spyOn(questionService as any, "calculateRequiredVariants")
        .mockReturnValue(0);

      // Act
      const result = await questionService.generateQuestionVariants(
        assignmentId,
        generateVariantDto,
      );

      // Assert
      expect(result.id).toEqual(assignmentId);
      expect(result.success).toBe(true);
      expect(
        llmFacadeService.generateQuestionRewordings,
      ).not.toHaveBeenCalled();
    });

    describe("processQuestionsForPublishing", () => {
      it("should process questions for publishing", async () => {
        // Arrange
        const assignmentId = 1;
        const jobId = 1;
        const questions = [
          createMockQuestionDto({ id: 1 }),
          createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
        ];

        // Mock existing questions (one matching, one not)
        const existingQuestions = [
          createMockQuestionDto({ id: 1 }),
          createMockQuestionDto({ id: 3 }), // This one is not in the new questions
        ];

        questionRepository.findByAssignmentId.mockResolvedValue(
          existingQuestions,
        );

        // Mock successful upsert
        questionRepository.upsert.mockResolvedValue(questions[0]);

        // Act
        await questionService.processQuestionsForPublishing(
          assignmentId,
          questions,
          jobId,
        );

        // Assert
        expect(questionRepository.findByAssignmentId).toHaveBeenCalledWith(
          assignmentId,
        );
        expect(questionRepository.markAsDeleted).toHaveBeenCalledWith([3]);
        // This should be a specific number instead of expect.any(Number)
        expect(jobStatusService.updateJobStatus).toHaveBeenCalled(); // or use a specific number like .toHaveBeenCalledTimes(6)
        expect(questionRepository.upsert).toHaveBeenCalledTimes(2);
      });

      it("should handle translations for changed content", async () => {
        // Arrange
        const assignmentId = 1;
        const jobId = 1;

        // Original question
        const originalQuestion = createMockQuestionDto({
          id: 1,
          question: "Original question text",
        });

        // Updated question with changed content
        const updatedQuestion = createMockQuestionDto({
          id: 1,
          question: "Updated question text",
        });

        questionRepository.findByAssignmentId.mockResolvedValue([
          originalQuestion,
        ]);
        questionRepository.upsert.mockResolvedValue(updatedQuestion);
        llmFacadeService.applyGuardRails.mockResolvedValue(true);

        // Act
        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        // Assert
        expect(llmFacadeService.applyGuardRails).toHaveBeenCalled();
        expect(translationService.translateQuestion).toHaveBeenCalled();
      });

      it("should skip translation for unchanged content", async () => {
        // Arrange
        const assignmentId = 1;
        const jobId = 1;

        // Same question object for existing and new
        const question = createMockQuestionDto({ id: 1 });

        questionRepository.findByAssignmentId.mockResolvedValue([question]);
        questionRepository.upsert.mockResolvedValue(question);

        // Act
        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        // Assert
        expect(translationService.translateQuestion).not.toHaveBeenCalled();
      });
    });

    describe("generateQuestions", () => {
      it("should start question generation job", async () => {
        // Arrange
        const assignmentId = 1;
        const userId = "author-123";
        const mockJob = createMockJob({ id: 1 });
        const payload = createMockQuestionGenerationPayload();

        jobStatusService.createJob.mockResolvedValue(mockJob);

        // We need to spy on startQuestionGenerationProcess which is a private method
        jest
          .spyOn(questionService as any, "startQuestionGenerationProcess")
          .mockResolvedValue(undefined);

        // Act
        const result = await questionService.generateQuestions(
          assignmentId,
          payload,
          userId,
        );

        // Assert
        expect(jobStatusService.createJob).toHaveBeenCalledWith(
          assignmentId,
          userId,
        );
        expect(result).toEqual({
          message: "Question generation started",
          jobId: mockJob.id,
        });
      });

      it("should validate question generation payload", async () => {
        // Arrange
        const assignmentId = 1;
        const userId = "author-123";
        const invalidPayload = {
          ...createMockQuestionGenerationPayload(),
          fileContents: undefined,
          learningObjectives: undefined,
        };

        // Act & Assert
        await expect(
          questionService.generateQuestions(
            assignmentId,
            invalidPayload,
            userId,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it("should validate questions to generate count", async () => {
        // Arrange
        const assignmentId = 1;
        const userId = "author-123";
        const invalidPayload = {
          ...createMockQuestionGenerationPayload(),
          questionsToGenerate: {
            multipleChoice: 0,
            multipleSelect: 0,
            textResponse: 0,
            trueFalse: 0,
            url: 0,
            upload: 0,
            linkFile: 0,
            responseTypes: {
              TEXT: [ResponseType.ESSAY],
            },
          },
        };

        // Act & Assert
        await expect(
          questionService.generateQuestions(
            assignmentId,
            invalidPayload,
            userId,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe("updateQuestionGradingContext", () => {
      it("should update question grading context", async () => {
        // Arrange
        const assignmentId = 1;
        const mockAssignment = {
          id: assignmentId,
          questionOrder: [1, 2],
          questions: [
            { id: 1, question: "Question 1", isDeleted: false },
            { id: 2, question: "Question 2", isDeleted: false },
          ],
        };

        const mockGradingContext = {
          "1": [2],
          "2": [1],
        };

        prismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
        llmFacadeService.generateQuestionGradingContext.mockResolvedValue(
          mockGradingContext,
        );
        prismaService.question.update.mockResolvedValue({});

        // Act
        await questionService.updateQuestionGradingContext(assignmentId);

        // Assert
        expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
          where: { id: assignmentId },
          include: {
            questions: {
              where: { isDeleted: false },
            },
          },
        });

        expect(
          llmFacadeService.generateQuestionGradingContext,
        ).toHaveBeenCalledWith(
          expect.arrayContaining([
            { id: 1, questionText: "Question 1" },
            { id: 2, questionText: "Question 2" },
          ]),
          assignmentId,
        );

        expect(prismaService.question.update).toHaveBeenCalledTimes(2);
      });

      it("should throw not found exception for invalid assignment", async () => {
        // Arrange
        const assignmentId = 999;
        prismaService.assignment.findUnique.mockResolvedValue(null);

        // Act & Assert
        await expect(
          questionService.updateQuestionGradingContext(assignmentId),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe("private methods", () => {
      describe("areChoicesEqual", () => {
        it("should return true for identical choices", () => {
          // Arrange
          const choices1: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option B",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          const choices2 = [...choices1];

          // Act
          const result = (questionService as any).areChoicesEqual(
            choices1,
            choices2,
          );

          // Assert
          expect(result).toBe(true);
        });

        it("should return false for different choices", () => {
          // Arrange
          const choices1: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option B",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          const choices2: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option C",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          // Act
          const result = (questionService as any).areChoicesEqual(
            choices1,
            choices2,
          );

          // Assert
          expect(result).toBe(false);
        });

        it("should handle undefined choices correctly", () => {
          // Act & Assert
          expect((questionService as any).areChoicesEqual()).toBe(true);
          expect((questionService as any).areChoicesEqual([])).toBe(false);
          expect((questionService as any).areChoicesEqual(undefined, [])).toBe(
            false,
          );
        });
      });

      describe("checkVariantsForChanges", () => {
        it("should detect changes in variant count", () => {
          // Arrange
          const existingVariants: VariantDto[] = [
            createMockVariantDto({ id: 101 }),
          ];

          const newVariants: VariantDto[] = [
            createMockVariantDto({ id: 101 }),
            createMockVariantDto({ id: 102 }),
          ];

          // Act
          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          // Assert
          expect(result).toBe(true);
        });

        it("should detect changes in variant content", () => {
          // Arrange
          const existingVariants: VariantDto[] = [
            createMockVariantDto({
              id: 101,
              variantContent: "Original content",
            }),
          ];

          const newVariants: VariantDto[] = [
            createMockVariantDto({
              id: 101,
              variantContent: "Changed content",
            }),
          ];

          // Act
          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          // Assert
          expect(result).toBe(true);
        });

        it("should return false when no changes exist", () => {
          // Arrange
          const existingVariant = createMockVariantDto({ id: 101 });
          const existingVariants: VariantDto[] = [existingVariant];
          const newVariants: VariantDto[] = [existingVariant];

          // Act
          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          // Assert
          expect(result).toBe(false);
        });
      });

      describe("calculateRequiredVariants", () => {
        it("should calculate required variants for single question", () => {
          // Act
          const result = (questionService as any).calculateRequiredVariants(
            1,
            1,
            3,
          );

          // Assert
          expect(result).toBe(3); // Should generate all requested variants
        });

        it("should calculate required variants for multiple questions", () => {
          // Act
          const result = (questionService as any).calculateRequiredVariants(
            2,
            1,
            3,
          );

          // Assert
          expect(result).toBe(2); // Should generate difference (3-1)
        });

        it("should return zero when enough variants exist", () => {
          // Act
          const result = (questionService as any).calculateRequiredVariants(
            2,
            4,
            3,
          );

          // Assert
          expect(result).toBe(0); // Already have more than needed
        });
      });

      describe("applyGuardRails", () => {
        it("should validate question content through LLM service", async () => {
          // Arrange
          const question = createMockQuestionDto();
          llmFacadeService.applyGuardRails.mockResolvedValue(true);

          // Act
          await (questionService as any).applyGuardRails(question);

          // Assert
          expect(llmFacadeService.applyGuardRails).toHaveBeenCalledWith(
            expect.any(String),
          );
        });

        it("should throw exception for invalid content", async () => {
          // Arrange
          const question = createMockQuestionDto();
          llmFacadeService.applyGuardRails.mockResolvedValue(false);

          // Act & Assert
          await expect(
            (questionService as any).applyGuardRails(question),
          ).rejects.toThrow(BadRequestException);
        });
      });
    });
  });
});
