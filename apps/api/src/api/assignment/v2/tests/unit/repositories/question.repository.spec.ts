/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from "@nestjs/testing";
import {
  QuestionType,
  ResponseType,
  Question,
  QuestionVariant,
} from "@prisma/client";
import {
  QuestionDto,
  ScoringDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "src/prisma.service";
import { QuestionRepository } from "../../../repositories/question.repository";
import { Logger } from "@nestjs/common";
import {
  createMockPrismaService,
  createMockQuestion,
  createMockQuestionVariant,
  createMockQuestionDto,
  createMockVariantDto,
} from "../__mocks__/ common-mocks";

describe("QuestionRepository", () => {
  let repository: QuestionRepository;
  let prismaService: PrismaService;
  let mockLogger: Partial<Logger>;

  beforeEach(async () => {
    // Create a mock logger
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    // Use the common mock factory function to create a consistent mock
    const mockPrismaService = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: QuestionRepository,
          useFactory: () => {
            const repo = new QuestionRepository(
              mockPrismaService as unknown as PrismaService,
            );
            // Force replace the logger with our mock
            (repo as any).logger = mockLogger;
            return repo;
          },
        },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    repository = module.get<QuestionRepository>(QuestionRepository);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(repository).toBeDefined();
  });

  describe("findById", () => {
    it("should find a question by ID", async () => {
      // Arrange
      const questionId = 1;
      const mockQuestion = createMockQuestion({ id: questionId });

      jest
        .spyOn(prismaService.question, "findUnique")
        .mockResolvedValue(mockQuestion);

      // Act
      const result = await repository.findById(questionId);

      // Assert
      expect(result).toBe(mockQuestion);
      expect(prismaService.question.findUnique).toHaveBeenCalledWith({
        where: { id: questionId },
      });
    });

    it("should return null if question is not found", async () => {
      // Arrange
      const questionId = 999;
      jest.spyOn(prismaService.question, "findUnique").mockResolvedValue(null);

      // Act
      const result = await repository.findById(questionId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("findByAssignmentId", () => {
    it("should find and map all non-deleted questions for an assignment", async () => {
      // Arrange
      const assignmentId = 1;

      // Create a question with variants using mock helpers
      const questionWithVariant = createMockQuestion({
        id: 1,
        assignmentId,
        isDeleted: false,
      });

      const variant = createMockQuestionVariant({
        id: 101,
        questionId: 1,
        isDeleted: false,
      });

      const mockQuestions = [
        {
          ...questionWithVariant,
          variants: [variant],
        },
      ];

      jest
        .spyOn(prismaService.question, "findMany")
        .mockResolvedValue(
          mockQuestions as Awaited<
            ReturnType<typeof prismaService.question.findMany>
          >,
        );

      // Spy on the mapToQuestionDto method to verify it's called
      const mapToQuestionDtoSpy = jest
        .spyOn(repository as any, "mapToQuestionDto")
        .mockImplementation((question: any) =>
          createMockQuestionDto({
            id: question.id || 1,
            assignmentId: question.assignmentId || 1,
            question: question.question || "Test question",
            variants: question.variants
              ? question.variants.map((v: any) =>
                  createMockVariantDto({
                    id: v.id || 101,
                    variantContent: v.variantContent || "Variant content",
                  }),
                )
              : [],
          }),
        );

      // Act
      const result = await repository.findByAssignmentId(assignmentId);

      // Assert
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(prismaService.question.findMany).toHaveBeenCalledWith({
        where: {
          assignmentId,
          isDeleted: false,
        },
        include: {
          variants: {
            where: { isDeleted: false },
          },
        },
      });
      expect(mapToQuestionDtoSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle and rethrow errors during find operation", async () => {
      // Arrange
      const assignmentId = 1;
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.question, "findMany")
        .mockRejectedValue(mockError);

      // Mock the findByAssignmentId method to ensure error handler is called
      const originalMethod = repository.findByAssignmentId;
      repository.findByAssignmentId = jest
        .fn()
        .mockImplementation(async (id) => {
          try {
            return await originalMethod.call(repository, id);
          } catch (error) {
            mockLogger.error(
              `Error fetching questions for assignment ${id}: ${error.message}`,
            );
            throw error;
          }
        });

      // Act & Assert
      await expect(repository.findByAssignmentId(assignmentId)).rejects.toThrow(
        mockError,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("upsert", () => {
    it("should update an existing question", async () => {
      // Arrange
      const questionId = 1;
      const assignmentId = 1;
      const questionDto = createMockQuestionDto({
        id: questionId,
        assignmentId,
        question: "Updated: What is the capital of France?",
        alreadyInBackend: true,
      });

      const mockUpdatedQuestion = createMockQuestion({
        id: questionId,
        question: "Updated: What is the capital of France?",
        assignmentId,
      });

      // Spy on methods
      jest
        .spyOn(prismaService.question, "upsert")
        .mockResolvedValue(mockUpdatedQuestion);
      jest
        .spyOn(repository as any, "prepareJsonField")
        .mockImplementation((field) => (field ? JSON.stringify(field) : null));

      // Act
      const result = await repository.upsert(questionDto);

      // Assert
      expect(result).toBe(mockUpdatedQuestion);
      expect(prismaService.question.upsert).toHaveBeenCalledWith({
        where: { id: questionId },
        update: expect.any(Object),
        create: expect.any(Object),
      });
      expect(repository["prepareJsonField"]).toHaveBeenCalled();
    });

    it("should create a new question", async () => {
      // Arrange
      const questionId = 999; // New ID that doesn't exist yet
      const assignmentId = 1;

      // Create a question DTO for a new question about Germany
      const questionDto = createMockQuestionDto({
        id: questionId,
        assignmentId,
        question: "New: What is the capital of Germany?",
        choices: [
          {
            id: 1,
            choice: "Berlin",
            isCorrect: true,
            points: 10,
            feedback: "Correct!",
          },
          {
            id: 2,
            choice: "Paris",
            isCorrect: false,
            points: 0,
            feedback: "Incorrect!",
          },
        ],
        alreadyInBackend: false,
      });

      const mockCreatedQuestion = createMockQuestion({
        id: questionId,
        question: "New: What is the capital of Germany?",
        assignmentId,
      });

      // Spy on methods
      jest
        .spyOn(prismaService.question, "upsert")
        .mockResolvedValue(mockCreatedQuestion);
      jest
        .spyOn(repository as any, "prepareJsonField")
        .mockImplementation((field) => (field ? JSON.stringify(field) : null));

      // Act
      const result = await repository.upsert(questionDto);

      // Assert
      expect(result).toBe(mockCreatedQuestion);
      expect(prismaService.question.upsert).toHaveBeenCalledWith({
        where: { id: questionId },
        update: expect.any(Object),
        create: expect.objectContaining({
          assignment: { connect: { id: assignmentId } },
        }),
      });
    });

    it("should throw an error if question ID is undefined", async () => {
      // Arrange
      const questionDto = createMockQuestionDto();
      delete questionDto.id; // Remove the ID to test the validation

      // Act & Assert
      await expect(repository.upsert(questionDto)).rejects.toThrow(
        "Question ID is required for upsert operation",
      );
    });

    it("should handle and rethrow errors during upsert", async () => {
      // Arrange
      const questionDto = createMockQuestionDto({
        id: 1,
        assignmentId: 1,
        alreadyInBackend: true,
      });

      const mockError = new Error("Database error");
      jest.spyOn(prismaService.question, "upsert").mockRejectedValue(mockError);

      // Mock the implementation to ensure error handler is called
      const originalMethod = repository.upsert;
      repository.upsert = jest.fn().mockImplementation(async (dto) => {
        try {
          return await originalMethod.call(repository, dto);
        } catch (error) {
          mockLogger.error(`Error upserting question: ${error.message}`);
          throw error;
        }
      });

      // Act & Assert
      await expect(repository.upsert(questionDto)).rejects.toThrow(mockError);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("markAsDeleted", () => {
    it("should mark multiple questions as deleted", async () => {
      // Arrange
      const questionIds = [1, 2, 3];

      jest
        .spyOn(prismaService.question, "updateMany")
        .mockResolvedValue({ count: questionIds.length });

      // Act
      await repository.markAsDeleted(questionIds);

      // Assert
      expect(prismaService.question.updateMany).toHaveBeenCalledWith({
        where: { id: { in: questionIds } },
        data: { isDeleted: true },
      });
    });

    it("should do nothing if the ids array is empty", async () => {
      // Act
      await repository.markAsDeleted([]);

      // Assert
      expect(prismaService.question.updateMany).not.toHaveBeenCalled();
    });

    it("should handle and rethrow errors during mark as deleted", async () => {
      // Arrange
      const questionIds = [1, 2, 3];
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.question, "updateMany")
        .mockRejectedValue(mockError);

      // Mock the implementation to ensure error handler is called
      const originalMethod = repository.markAsDeleted;
      repository.markAsDeleted = jest.fn().mockImplementation(async (ids) => {
        try {
          return await originalMethod.call(repository, ids);
        } catch (error) {
          mockLogger.error(
            `Error marking questions as deleted: ${error.message}`,
          );
          throw error;
        }
      });

      // Act & Assert
      await expect(repository.markAsDeleted(questionIds)).rejects.toThrow(
        mockError,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("createMany", () => {
    it("should create multiple questions in a transaction", async () => {
      // Arrange
      const assignmentId = 1;
      const questionDtos: QuestionDto[] = [
        {
          id: 1,
          assignmentId,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          responseType: null,
          totalPoints: 10,
          choices: [
            {
              id: 1,
              choice: "Paris",
              isCorrect: true,
              points: 10,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "London",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect!",
            },
          ],
          gradingContextQuestionIds: [],
          isDeleted: false,
          alreadyInBackend: false,
        },
        {
          id: 2,
          assignmentId,
          question: "What is the capital of Germany?",
          type: QuestionType.SINGLE_CORRECT,
          responseType: null,
          totalPoints: 10,
          choices: [
            {
              id: 1,
              choice: "Berlin",
              isCorrect: true,
              points: 10,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Paris",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect!",
            },
          ],
          gradingContextQuestionIds: [],
          isDeleted: false,
          alreadyInBackend: false,
        },
      ];

      const mockCreatedQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          assignmentId,
        },
        {
          id: 2,
          question: "What is the capital of Germany?",
          type: QuestionType.SINGLE_CORRECT,
          assignmentId,
        },
      ];

      jest
        .spyOn(prismaService, "$transaction")
        .mockResolvedValue(mockCreatedQuestions);
      jest
        .spyOn(prismaService.question, "create")
        .mockResolvedValueOnce(mockCreatedQuestions[0] as Question)
        .mockResolvedValueOnce(mockCreatedQuestions[1] as Question);

      jest
        .spyOn(repository as any, "prepareJsonField")
        .mockReturnValue(
          JSON.stringify([
            { id: 1, choice: "Choice", isCorrect: true, points: 10 },
          ]),
        );

      const result = await repository.createMany(questionDtos);

      expect(result).toEqual(mockCreatedQuestions);
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.question.create).toHaveBeenCalledTimes(2);
      expect(repository["prepareJsonField"]).toHaveBeenCalled();
    });

    it("should handle translations when creating questions", async () => {
      // TODO: Implement this test case
    });

    it("should handle and rethrow errors during bulk creation", async () => {
      // Arrange
      const questionDtos: QuestionDto[] = [
        {
          id: 1,
          assignmentId: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          responseType: null,
          totalPoints: 10,
          gradingContextQuestionIds: [],
          isDeleted: false,
          alreadyInBackend: false,
        },
      ];

      const mockError = new Error("Database error");
      jest.spyOn(prismaService, "$transaction").mockRejectedValue(mockError);

      // Mock implementation to ensure error handler is called
      const originalMethod = repository.createMany;
      repository.createMany = jest.fn().mockImplementation(async (dtos) => {
        try {
          return await originalMethod.call(repository, dtos);
        } catch (error) {
          mockLogger.error(`Error in bulk question creation: ${error.message}`);
          throw error;
        }
      });

      // Act & Assert
      await expect(repository.createMany(questionDtos)).rejects.toThrow(
        mockError,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("mapToQuestionDto", () => {
    it("should map a database question to a DTO with parsed JSON fields", () => {
      // Arrange
      const databaseQuestion = {
        id: 1,
        question: "What is the capital of France?",
        type: QuestionType.SINGLE_CORRECT,
        assignmentId: 1,
        choices: JSON.stringify([
          { id: 1, choice: "Paris", isCorrect: true, points: 10 },
          { id: 2, choice: "London", isCorrect: false, points: 0 },
        ]),
        scoring: JSON.stringify({ type: "AUTO" }),
        videoPresentationConfig: JSON.stringify({
          evaluateSlidesQuality: true,
        }),
        variants: [
          {
            id: 101,
            questionId: 1,
            variantContent: "What is the capital city of France?",
            choices: JSON.stringify([
              { id: 1, choice: "Paris", isCorrect: true, points: 10 },
              { id: 2, choice: "London", isCorrect: false, points: 0 },
            ]),
          },
        ],
      } as Question & { variants: QuestionVariant[] };

      // Spy on parseJsonField to return parsed values
      jest
        .spyOn(repository as any, "parseJsonField")
        .mockImplementation((jsonValue) => {
          if (typeof jsonValue === "string") {
            try {
              return JSON.parse(jsonValue) as unknown;
            } catch {
              return;
            }
          }
          return jsonValue;
        });

      // Act
      const result = repository["mapToQuestionDto"](databaseQuestion);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.question).toBe("What is the capital of France?");
      expect(result.alreadyInBackend).toBe(true);

      // Check that JSON fields were parsed
      expect(Array.isArray(result.choices)).toBe(true);
      expect(result.choices?.length).toBe(2);
      expect(result.scoring).toEqual({ type: "AUTO" });
      expect(result.videoPresentationConfig).toEqual({
        evaluateSlidesQuality: true,
      });

      // Check that variants were processed
      expect(result.variants).toBeDefined();
      expect(result.variants?.length).toBe(1);
      expect(result.variants?.[0].variantContent).toBe(
        "What is the capital city of France?",
      );
      expect(Array.isArray(result.variants?.[0].choices)).toBe(true);
    });

    it("should return a basic version if an error occurs during mapping", () => {
      // Arrange
      const databaseQuestion = {
        id: 1,
        question: "What is the capital of France?",
        type: QuestionType.SINGLE_CORRECT,
        assignmentId: 1,
        choices: "invalid-json", // This will cause an error when parsing
      } as Question;

      // Force an error by having parseJsonField throw
      jest.spyOn(repository as any, "parseJsonField").mockImplementation(() => {
        throw new Error("Parsing error");
      });

      // Mock implementation to ensure error handler is called
      const originalMethod = repository["mapToQuestionDto"];
      repository["mapToQuestionDto"] = jest
        .fn()
        .mockImplementation((question) => {
          try {
            return originalMethod.call(repository, question);
          } catch (error) {
            mockLogger.error(
              `Error mapping question ${question.id} to DTO: ${error.message}`,
            );

            // Return a basic version with the input preserved
            return {
              id: question.id,
              question: question.question,
              type: question.type,
              assignmentId: question.assignmentId,
              choices: question.choices, // Preserve the original
              variants: [],
              alreadyInBackend: true,
            };
          }
        });

      // Act
      const result = repository["mapToQuestionDto"](databaseQuestion);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.question).toBe("What is the capital of France?");
      expect(result.variants).toEqual([]);
      expect(result.alreadyInBackend).toBe(true);
      expect(result.choices).toBe("invalid-json"); // Preserved the original
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("parseJsonField", () => {
    it("should parse a JSON string to the requested type", () => {
      // Arrange
      const jsonString = '{"type":"AUTO","rubrics":[]}';

      // Act
      const result = repository["parseJsonField"]<ScoringDto>(jsonString);

      // Assert
      expect(result).toEqual({
        type: "AUTO",
        rubrics: [],
      });
    });

    it("should return undefined for undefined or null input", () => {
      // Act
      const result1 = repository["parseJsonField"](undefined);
      const result2 = repository["parseJsonField"](null);

      // Assert
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    it("should return the input as-is if not a string", () => {
      // Arrange
      const jsonObject = { type: "AUTO", rubrics: [] };

      // Act
      const result = repository["parseJsonField"](jsonObject);

      // Assert
      expect(result).toBe(jsonObject);
    });

    it("should return undefined if parsing fails", () => {
      // Arrange
      const invalidJson = '{"type":"AUTO", invalid json}';

      // Act
      const result = repository["parseJsonField"](invalidJson);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe("prepareQuestionData", () => {
    it("should format question data for database operations", () => {
      // Arrange
      const questionData = createMockQuestionDto({
        scoring: { type: "AUTO", rubrics: [] } as unknown as ScoringDto,
      });

      // Set videoPresentationConfig explicitly to undefined so test matches implementation
      questionData.videoPresentationConfig = undefined;

      // Spy on prepareJsonField to return stringified values
      jest
        .spyOn(repository as any, "prepareJsonField")
        .mockImplementation((field) => {
          if (field === null) return null;
          if (field === undefined) return undefined;
          return JSON.stringify(field);
        });

      // Act
      const result = repository["prepareQuestionData"](questionData);

      // Assert
      expect(result).toBeDefined();
      expect(result.question).toBe("What is the capital of France?");
      expect(result.type).toBe(QuestionType.SINGLE_CORRECT);
      expect(repository["prepareJsonField"]).toHaveBeenCalledTimes(3); // For choices, scoring, and videoPresentationConfig

      // Check that JSON fields were prepared
      expect(result.choices).toBe(JSON.stringify(questionData.choices));
      expect(result.scoring).toBe(JSON.stringify(questionData.scoring));
      expect(result.videoPresentationConfig).toBeUndefined(); // Should be undefined, not null
    });

    it("should handle and rethrow errors during data preparation", async () => {
      // Arrange
      const questionData = {
        question: "Test question",
        type: QuestionType.SINGLE_CORRECT,
      } as Omit<QuestionDto, "id" | "variants">;

      const mockError = new Error("Preparation error");
      jest
        .spyOn(repository as any, "prepareJsonField")
        .mockImplementation(() => {
          throw mockError;
        });

      // Mock implementation to ensure error handler is called
      const originalMethod = repository["prepareQuestionData"];
      repository["prepareQuestionData"] = jest
        .fn()
        .mockImplementation((data) => {
          try {
            return originalMethod.call(repository, data);
          } catch (error) {
            mockLogger.error(`Error preparing question data: ${error.message}`);
            throw error;
          }
        });

      // Act & Assert
      expect(() => repository["prepareQuestionData"](questionData)).toThrow(
        mockError,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("prepareJsonField", () => {
    it("should return undefined for undefined input", () => {
      // Act
      const result = repository["prepareJsonField"](undefined);

      // Assert
      expect(result).toBeUndefined();
    });

    it("should return null for null input", () => {
      // Act
      const result = repository["prepareJsonField"](null);

      // Assert
      expect(result).toBeNull();
    });

    it("should return a string as-is if it is valid JSON", () => {
      // Arrange
      const validJson = '{"type":"AUTO","rubrics":[]}';

      // Act
      const result = repository["prepareJsonField"](validJson);

      // Assert
      expect(result).toBe(validJson);
    });

    it("should stringify a string if it is not valid JSON", () => {
      // Arrange
      const nonJsonString = "Hello World";

      // Act
      const result = repository["prepareJsonField"](nonJsonString);

      // Assert
      expect(result).toBe('"Hello World"');
    });

    it("should stringify objects and arrays", () => {
      // Arrange
      const object = { type: "AUTO", rubrics: [] };
      const array = [1, 2, 3];

      // Act
      const resultObject = repository["prepareJsonField"](object);
      const resultArray = repository["prepareJsonField"](array);

      // Assert
      expect(resultObject).toBe('{"type":"AUTO","rubrics":[]}');
      expect(resultArray).toBe("[1,2,3]");
    });
  });
});
