/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { Assignment, QuestionType } from "@prisma/client";
import { GetAssignmentResponseDto } from "src/api/assignment/dto/get.assignment.response.dto";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AssignmentRepository } from "../../../repositories/assignment.repository";
import {
  createMockAssignment,
  sampleAuthorSession,
  sampleLearnerSession,
} from "../__mocks__/ common-mocks";
import { BaseAssignmentResponseDto } from "src/api/admin/dto/assignment/base.assignment.response.dto";

describe("AssignmentRepository", () => {
  let repository: AssignmentRepository;
  let prismaService: PrismaService;

  beforeEach(async () => {
    // Create a mock PrismaService
    const mockPrismaService = {
      assignment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      assignmentGroup: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<AssignmentRepository>(AssignmentRepository);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(repository).toBeDefined();
  });

  describe("findById", () => {
    it("should find and return an assignment for an author", async () => {
      // Arrange
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [
            {
              id: 101,
              questionId: 1,
              variantContent: "What is the capital city of France?",
              isDeleted: false,
              choices: JSON.stringify([
                { id: 1, choice: "Paris", isCorrect: true, points: 10 },
                { id: 2, choice: "London", isCorrect: false, points: 0 },
              ]),
            },
          ],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      // Mock JSON.parse to handle our mock data properly
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown; // Return the input if it's not a string (for our mock data)
      });

      // Act
      const result = await repository.findById(
        assignmentId,
        sampleAuthorSession,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;

      // Verify Prisma was called correctly
      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
        include: {
          questions: {
            include: { variants: true },
          },
        },
      });
    });

    it("should find and return an assignment for a learner (without questions)", async () => {
      // Arrange
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      // Mock JSON.parse to handle our mock data properly
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      // Act
      const result = await repository.findById(
        assignmentId,
        sampleLearnerSession,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeUndefined(); // Learners don't get questions

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;
    });

    it("should throw NotFoundException if assignment is not found", async () => {
      // Arrange
      const assignmentId = 999;
      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(null);

      // Act & Assert
      await expect(repository.findById(assignmentId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
        include: {
          questions: {
            include: { variants: true },
          },
        },
      });
    });

    it("should filter out deleted questions and variants", async () => {
      // Arrange
      const assignmentId = 1;
      const mockQuestions = [
        // Non-deleted question with variants
        {
          id: 1,
          question: "What is the capital of France?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          scoring: JSON.stringify({ type: "AUTO" }),
          choices: JSON.stringify([
            { id: 1, choice: "Paris", isCorrect: true, points: 10 },
            { id: 2, choice: "London", isCorrect: false, points: 0 },
          ]),
          variants: [
            {
              id: 101,
              questionId: 1,
              variantContent: "What is the capital city of France?",
              isDeleted: false,
              choices: JSON.stringify([]),
            },
            {
              id: 102,
              questionId: 1,
              variantContent: "Paris is the capital of which country?",
              isDeleted: true, // This variant should be filtered out
              choices: JSON.stringify([]),
            },
          ],
          assignmentId: 1,
        },
        // Deleted question (should be filtered out)
        {
          id: 2,
          question: "What is the capital of Germany?",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: true,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
        questionOrder: [1, 2],
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      // Mock JSON.parse for our test data
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      // Act
      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // Assert
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1); // Only one non-deleted question
      expect(result.questions[0].id).toBe(1);

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;
    });

    it("should sort questions based on questionOrder if available", async () => {
      // Arrange
      const assignmentId = 1;
      const mockQuestions = [
        {
          id: 3,
          question: "Question 3",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
        {
          id: 1,
          question: "Question 1",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
        {
          id: 2,
          question: "Question 2",
          type: QuestionType.SINGLE_CORRECT,
          isDeleted: false,
          choices: JSON.stringify([]),
          variants: [],
          assignmentId: 1,
        },
      ];

      const mockAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        questions: mockQuestions,
        questionOrder: [2, 1, 3], // Custom order: Q2, Q1, Q3
      };

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(mockAssignment);

      // Mock JSON.parse for our test data
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      // Act
      const result = (await repository.findById(
        assignmentId,
        sampleAuthorSession,
      )) as GetAssignmentResponseDto;

      // Assert
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(3);
      // Questions should be sorted according to questionOrder
      expect(result.questions[0].id).toBe(2); // First question should be id 2
      expect(result.questions[1].id).toBe(1); // Second question should be id 1
      expect(result.questions[2].id).toBe(3); // Third question should be id 3

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;
    });
  });

  describe("findAllForUser", () => {
    it("should return all assignments for a user", async () => {
      // Arrange
      const mockAssignmentGroups = [
        {
          groupId: "group1",
          assignmentId: 1,
          assignment: createMockAssignment({ id: 1, name: "Assignment 1" }),
        },
        {
          groupId: "group1",
          assignmentId: 2,
          assignment: createMockAssignment({ id: 2, name: "Assignment 2" }),
        },
      ];

      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockResolvedValue(mockAssignmentGroups);

      // Act
      const result = await repository.findAllForUser(sampleLearnerSession);

      // Assert
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe("Assignment 1");
      expect(result[1].id).toBe(2);
      expect(result[1].name).toBe("Assignment 2");

      // Verify Prisma was called correctly
      expect(prismaService.assignmentGroup.findMany).toHaveBeenCalledWith({
        where: { groupId: sampleLearnerSession.groupId },
        include: { assignment: true },
      });
    });

    it("should return an empty array if no assignments are found", async () => {
      // Arrange
      jest
        .spyOn(prismaService.assignmentGroup, "findMany")
        .mockResolvedValue([]);

      // Act
      const result = await repository.findAllForUser(sampleLearnerSession);

      // Assert
      expect(result).toBeDefined();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("should update an assignment successfully", async () => {
      // Arrange
      const assignmentId = 1;
      const updateData = {
        name: "Updated Assignment Name",
        introduction: "Updated introduction",
      };

      const updatedAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        ...updateData,
      };

      jest
        .spyOn(prismaService.assignment, "update")
        .mockResolvedValue(updatedAssignment);

      // Act
      const result = await repository.update(assignmentId, updateData);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.name).toBe(updateData.name);
      expect(result.introduction).toBe(updateData.introduction);

      // Verify Prisma was called correctly
      expect(prismaService.assignment.update).toHaveBeenCalledWith({
        where: { id: assignmentId },
        data: updateData,
      });
    });

    it("should throw and log errors during update", async () => {
      // Arrange
      const assignmentId = 1;
      const updateData = { name: "Updated Assignment" };
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.assignment, "update")
        .mockRejectedValue(mockError);
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      // Act & Assert
      await expect(repository.update(assignmentId, updateData)).rejects.toThrow(
        mockError,
      );
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("replace", () => {
    it("should replace an assignment with new data", async () => {
      // Arrange
      const assignmentId = 1;
      const replaceData = {
        name: "Completely New Assignment",
        introduction: "Brand new introduction",
        instructions: "New instructions",
      };

      // Expected data to be passed to Prisma (empty DTO + new data)
      const expectedData: Record<string, unknown> = {
        ...repository["createEmptyDto"](),
        ...replaceData,
      };

      const replacedAssignment = {
        ...createMockAssignment({ id: assignmentId }),
        ...replaceData,
      };

      jest
        .spyOn(prismaService.assignment, "update")
        .mockResolvedValue(replacedAssignment);
      jest.spyOn(repository as any, "createEmptyDto").mockReturnValue({
        instructions: undefined,
        numAttempts: undefined,
        allotedTimeMinutes: undefined,
        attemptsPerTimeRange: undefined,
        attemptsTimeRangeHours: undefined,
        displayOrder: undefined,
      });

      // Act
      const result = await repository.replace(assignmentId, replaceData);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(assignmentId);
      expect(result.name).toBe(replaceData.name);
      expect(result.introduction).toBe(replaceData.introduction);
      expect(result.instructions).toBe(replaceData.instructions);

      // Verify Prisma was called correctly with the combined data
      expect(prismaService.assignment.update).toHaveBeenCalledWith({
        where: { id: assignmentId },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining(expectedData),
      });
    });

    it("should throw and log errors during replace", async () => {
      // Arrange
      const assignmentId = 1;
      const replaceData = { name: "Completely New Assignment" };
      const mockError = new Error("Database error");

      jest
        .spyOn(prismaService.assignment, "update")
        .mockRejectedValue(mockError);
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      // Act & Assert
      await expect(
        repository.replace(assignmentId, replaceData),
      ).rejects.toThrow(mockError);
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("parseJsonField", () => {
    it("should parse a JSON string to the correct type", () => {
      // Arrange
      const jsonString = '{"type":"AUTO","rubrics":[]}';

      // Act
      const result = repository["parseJsonField"]<ScoringDto>(jsonString);

      // Assert
      expect(result).toBeDefined();
      expect(result).toEqual({
        type: "AUTO",
        rubrics: [],
      });
    });

    it("should return undefined for null input", () => {
      // Act
      const result = repository["parseJsonField"](null);

      // Assert
      expect(result).toBeUndefined();
    });

    it("should return the input as-is if not a string", () => {
      // Arrange
      const jsonObject = { type: "AUTO", rubrics: [] };

      // Act
      const result = repository["parseJsonField"](jsonObject);

      // Assert
      expect(result).toBe(jsonObject);
    });

    it("should handle invalid JSON and return undefined", () => {
      // Arrange
      const invalidJson = '{"type":"AUTO", invalid json}';
      jest.spyOn(repository["logger"], "error").mockImplementation(jest.fn());

      // Act
      const result = repository["parseJsonField"](invalidJson);

      // Assert
      expect(result).toBeUndefined();
      expect(repository["logger"].error).toHaveBeenCalled();
    });
  });

  describe("createEmptyDto", () => {
    it("should return an empty assignment DTO with undefined values", () => {
      // Act
      const result = repository["createEmptyDto"]();

      // Assert
      expect(result).toBeDefined();
      expect(result.instructions).toBeUndefined();
      expect(result.numAttempts).toBeUndefined();
      expect(result.allotedTimeMinutes).toBeUndefined();
      expect(result.attemptsPerTimeRange).toBeUndefined();
      expect(result.attemptsTimeRangeHours).toBeUndefined();
      expect(result.displayOrder).toBeUndefined();
    });
  });

  describe("processAssignmentData", () => {
    it("should process raw assignment data with questions and variants", () => {
      // Arrange
      const rawAssignment = {
        ...createMockAssignment({ id: 1 }),
        questions: [
          {
            id: 1,
            question: "What is the capital of France?",
            type: QuestionType.SINGLE_CORRECT,
            isDeleted: false,
            scoring: JSON.stringify({ type: "AUTO" }),
            choices: JSON.stringify([
              { id: 1, choice: "Paris", isCorrect: true, points: 10 },
              { id: 2, choice: "London", isCorrect: false, points: 0 },
            ]),
            variants: [
              {
                id: 101,
                questionId: 1,
                variantContent: "What is the capital city of France?",
                isDeleted: false,
                choices: JSON.stringify([
                  { id: 1, choice: "Paris", isCorrect: true, points: 10 },
                  { id: 2, choice: "London", isCorrect: false, points: 0 },
                ]),
              },
            ],
            assignmentId: 1,
          },
        ],
      };

      // Spy on methods used by processAssignmentData
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

      // Mock JSON.parse for our test
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      // Act
      const result = repository["processAssignmentData"](rawAssignment as any);

      // Assert
      expect(result).toBeDefined();
      expect(result.questions).toBeDefined();
      expect(result.questions.length).toBe(1);

      // Check that question was processed correctly
      const processedQuestion = result.questions[0];
      expect(processedQuestion.id).toBe(1);
      expect(processedQuestion.scoring).toEqual({ type: "AUTO" });
      expect(Array.isArray(processedQuestion.choices)).toBe(true);
      expect(processedQuestion.choices.length).toBe(2);

      // Check that variant was processed correctly
      expect(processedQuestion.variants).toBeDefined();
      expect(processedQuestion.variants.length).toBe(1);
      expect(processedQuestion.variants[0].id).toBe(101);
      expect(Array.isArray(processedQuestion.variants[0].choices)).toBe(true);

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;
    });

    it("should handle missing or empty questions array", () => {
      // Arrange
      const rawAssignment = {
        ...createMockAssignment({ id: 1 }),
        questions: undefined,
      };

      // Mock JSON.parse for our test
      const originalJsonParse = JSON.parse;
      global.JSON.parse = jest.fn().mockImplementation((text) => {
        if (typeof text === "string") {
          return originalJsonParse(text) as unknown;
        }
        return text as unknown;
      });

      // Act
      const result = repository["processAssignmentData"](rawAssignment as any);

      // Assert
      expect(result).toBeDefined();
      expect(result.questions).toEqual([]);

      // Restore original JSON.parse
      global.JSON.parse = originalJsonParse;
    });
  });
});
