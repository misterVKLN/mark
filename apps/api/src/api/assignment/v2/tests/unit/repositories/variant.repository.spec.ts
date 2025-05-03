/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/no-null */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "src/prisma.service";
import { Prisma, VariantType } from "@prisma/client";
import { VariantRepository } from "../../../repositories/variant.repository";
import {
  createMockPrismaService,
  createMockQuestionVariant,
  createMockVariantDto,
  sampleChoiceA,
  sampleChoiceB,
  sampleChoiceC,
} from "../__mocks__/ common-mocks";
import { VariantDto } from "src/api/assignment/dto/update.questions.request.dto";

describe("VariantRepository", () => {
  let variantRepository: VariantRepository;
  let prismaService: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    // Create mock PrismaService using the utility from common-mocks
    prismaService = createMockPrismaService();

    // Create a testing module with our repository and mocked dependencies
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariantRepository,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    // Get the repository instance from the testing module
    variantRepository = module.get<VariantRepository>(VariantRepository);
  });
  describe("findById", () => {
    it("should find a variant by ID", async () => {
      // Arrange
      const mockVariant = createMockQuestionVariant();
      prismaService.questionVariant.findUnique.mockResolvedValue(mockVariant);

      // Act
      const result = await variantRepository.findById(mockVariant.id);

      // Assert
      expect(prismaService.questionVariant.findUnique).toHaveBeenCalledWith({
        where: { id: mockVariant.id },
      });
      expect(result).toEqual(mockVariant);
    });

    it("should return null if variant is not found", async () => {
      // Arrange
      prismaService.questionVariant.findUnique.mockResolvedValue(null);

      // Act
      const result = await variantRepository.findById(999);

      // Assert
      expect(prismaService.questionVariant.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
      });
      expect(result).toBeNull();
    });
  });

  describe("findByQuestionId", () => {
    it("should find all non-deleted variants for a question", async () => {
      // Arrange
      const mockVariants = [
        createMockQuestionVariant({ id: 101, questionId: 1 }),
        createMockQuestionVariant({ id: 102, questionId: 1 }),
      ];
      prismaService.questionVariant.findMany.mockResolvedValue(mockVariants);

      // Act
      const result = await variantRepository.findByQuestionId(1);

      // Assert
      expect(prismaService.questionVariant.findMany).toHaveBeenCalledWith({
        where: {
          questionId: 1,
          isDeleted: false,
        },
      });
      expect(result).toEqual(mockVariants);
    });

    it("should handle errors when finding variants", async () => {
      // Arrange
      const error = new Error("Database error");
      prismaService.questionVariant.findMany.mockRejectedValue(error);

      // Act & Assert
      await expect(variantRepository.findByQuestionId(1)).rejects.toThrow(
        error,
      );
    });
  });

  describe("create", () => {
    it("should create a new variant", async () => {
      // Arrange
      const variantDto = createMockVariantDto({ id: undefined });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const mockCreatedVariant = createMockQuestionVariant({ questionId });
      prismaService.questionVariant.create.mockResolvedValue(
        mockCreatedVariant,
      );

      // Spy on private method
      jest
        .spyOn(variantRepository as any, "prepareVariantCreateData")
        .mockReturnValue({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          createdAt: new Date(),
          choices: JSON.stringify([
            sampleChoiceA,
            sampleChoiceB,
            sampleChoiceC,
          ]),
          scoring: null,
          variantOf: {
            connect: { id: questionId },
          },
        });

      // Act
      const result = await variantRepository.create(dataWithQuestionId);

      // Assert
      expect(prismaService.questionVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining<
          Partial<Prisma.QuestionVariantCreateInput>
        >({
          variantContent: variantDto.variantContent,
          variantOf: {
            connect: { id: questionId },
          },
        }),
      });
      expect(result).toEqual(mockCreatedVariant);
    });

    it("should handle errors when creating a variant", async () => {
      // Arrange
      const variantDto = createMockVariantDto();
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const error = new Error("Database error");
      prismaService.questionVariant.create.mockRejectedValue(error);

      // Act & Assert
      await expect(
        variantRepository.create(dataWithQuestionId),
      ).rejects.toThrow(error);
    });
  });

  describe("update", () => {
    it("should update an existing variant", async () => {
      // Arrange
      const variantId = 101;
      const variantDto = createMockVariantDto({ id: variantId });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const mockUpdatedVariant = createMockQuestionVariant({
        id: variantId,
        questionId,
      });
      prismaService.questionVariant.update.mockResolvedValue(
        mockUpdatedVariant,
      );

      // Spy on private method
      jest
        .spyOn<any, any>(variantRepository, "prepareVariantUpdateData")
        .mockReturnValue({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          choices: JSON.stringify([
            sampleChoiceA,
            sampleChoiceB,
            sampleChoiceC,
          ]),
          scoring: null,
        });

      // Act
      const result = await variantRepository.update(
        variantId,
        dataWithQuestionId,
      );

      // Assert
      expect(prismaService.questionVariant.update).toHaveBeenCalledWith({
        where: { id: variantId },
        data: expect.objectContaining({
          variantContent: variantDto.variantContent,
        }),
      });
      expect(result).toEqual(mockUpdatedVariant);
    });

    it("should handle errors when updating a variant", async () => {
      // Arrange
      const variantId = 101;
      const variantDto = createMockVariantDto({ id: variantId });
      const questionId = 1;
      const dataWithQuestionId = { ...variantDto, questionId };

      const error = new Error("Database error");
      prismaService.questionVariant.update.mockRejectedValue(error);

      // Act & Assert
      await expect(
        variantRepository.update(variantId, dataWithQuestionId),
      ).rejects.toThrow(error);
    });
  });

  describe("markAsDeleted", () => {
    it("should mark variants as deleted", async () => {
      // Arrange
      const variantIds = [101, 102];
      prismaService.questionVariant.updateMany.mockResolvedValue({ count: 2 });

      // Act
      await variantRepository.markAsDeleted(variantIds);

      // Assert
      expect(prismaService.questionVariant.updateMany).toHaveBeenCalledWith({
        where: { id: { in: variantIds } },
        data: { isDeleted: true },
      });
    });

    it("should do nothing when given an empty array", async () => {
      // Arrange & Act
      await variantRepository.markAsDeleted([]);

      // Assert
      expect(prismaService.questionVariant.updateMany).not.toHaveBeenCalled();
    });

    it("should handle errors when marking variants as deleted", async () => {
      // Arrange
      const variantIds = [101, 102];
      const error = new Error("Database error");
      prismaService.questionVariant.updateMany.mockRejectedValue(error);

      // Act & Assert
      await expect(variantRepository.markAsDeleted(variantIds)).rejects.toThrow(
        error,
      );
    });
  });

  describe("createMany", () => {
    it("should create multiple variants in a transaction", async () => {
      // Arrange
      const variantDtos = [
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
      ];

      const mockCreatedVariants = [
        createMockQuestionVariant({ id: 201, questionId: 1 }),
        createMockQuestionVariant({ id: 202, questionId: 1 }),
      ];

      // Mock transaction return value
      prismaService.$transaction.mockResolvedValue(mockCreatedVariants);

      // Spy on private method
      jest
        .spyOn<any, any>(variantRepository, "prepareVariantCreateData")
        .mockImplementation((...arguments_: unknown[]) => {
          const data = arguments_[0] as VariantDto & { questionId: number };
          return {
            variantContent: data.variantContent,
            maxWords: data.maxWords,
            maxCharacters: data.maxCharacters,
            randomizedChoices: data.randomizedChoices,
            variantType: data.variantType,
            createdAt: expect.any(Date),
            choices: JSON.stringify([
              sampleChoiceA,
              sampleChoiceB,
              sampleChoiceC,
            ]),
            scoring: null,
            variantOf: {
              connect: { id: data.questionId },
            },
          };
        });
      // Act
      const result = await variantRepository.createMany(variantDtos);

      // Assert
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedVariants);
    });

    it("should return an empty array when given an empty array", async () => {
      // Arrange & Act
      const result = await variantRepository.createMany([]);

      // Assert
      expect(prismaService.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should handle errors when creating multiple variants", async () => {
      // Arrange
      const variantDtos = [
        { ...createMockVariantDto({ id: undefined }), questionId: 1 },
      ];

      const error = new Error("Transaction error");
      prismaService.$transaction.mockRejectedValue(error);

      // Act & Assert
      await expect(variantRepository.createMany(variantDtos)).rejects.toThrow(
        error,
      );
    });
  });

  describe("mapToVariantDto", () => {
    it("should map a database variant to a DTO", () => {
      // Arrange
      const mockVariant = createMockQuestionVariant();

      // Spy on private method
      jest
        .spyOn<any, any>(variantRepository, "parseJsonField")
        .mockImplementation((field) => {
          if (field === mockVariant.choices)
            return [sampleChoiceA, sampleChoiceB, sampleChoiceC];
          if (field === mockVariant.scoring) return null;
          return undefined;
        });

      // Act
      const result = variantRepository.mapToVariantDto(mockVariant);

      // Assert
      expect(result).toEqual({
        id: mockVariant.id,
        questionId: mockVariant.questionId,
        variantContent: mockVariant.variantContent,
        choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
        scoring: null,
        maxWords: mockVariant.maxWords,
        maxCharacters: mockVariant.maxCharacters,
        randomizedChoices: mockVariant.randomizedChoices,
        variantType: VariantType.REWORDED,
      });
    });
  });

  // Add tests for private methods if needed
  describe("private methods", () => {
    // Note: These tests are accessing private methods for test coverage.
    // In real-world scenarios, you may decide not to test private methods directly.

    describe("prepareJsonField", () => {
      it("should return undefined for undefined input", () => {
        // Act
        const result = (variantRepository as any).prepareJsonField(undefined);

        // Assert
        expect(result).toBeUndefined();
      });

      it("should return null for null input", () => {
        // Act
        const result = (variantRepository as any).prepareJsonField(null);

        // Assert
        expect(result).toBeNull();
      });

      it("should return the input if it is already a JSON string", () => {
        // Arrange
        const jsonString = JSON.stringify({ test: "value" });

        // Act
        const result = (variantRepository as any).prepareJsonField(jsonString);

        // Assert
        expect(result).toBe(jsonString);
      });

      it("should stringify non-JSON string input", () => {
        // Arrange
        const nonJsonString = "test string";

        // Act
        const result = (variantRepository as any).prepareJsonField(
          nonJsonString,
        );

        // Assert
        expect(result).toBe('"test string"');
      });

      it("should stringify object input", () => {
        // Arrange
        const object = { test: "value" };

        // Act
        const result = (variantRepository as any).prepareJsonField(object);

        // Assert
        expect(result).toBe(JSON.stringify(object));
      });
    });

    describe("parseJsonField", () => {
      it("should return undefined for undefined input", () => {
        // Act
        const result = (variantRepository as any).parseJsonField(undefined);

        // Assert
        expect(result).toBeUndefined();
      });

      it("should return undefined for null input", () => {
        // Act
        const result = (variantRepository as any).parseJsonField(null);

        // Assert
        expect(result).toBeUndefined();
      });

      it("should parse JSON string input", () => {
        // Arrange
        const jsonString = JSON.stringify({ test: "value" });

        // Act
        const result = (variantRepository as any).parseJsonField(jsonString);

        // Assert
        expect(result).toEqual({ test: "value" });
      });

      it("should return undefined for invalid JSON string input", () => {
        // Arrange
        const invalidJsonString = "not valid json";

        // Act
        const result = (variantRepository as any).parseJsonField(
          invalidJsonString,
        );

        // Assert
        expect(result).toBeUndefined();
      });

      it("should return the input as is for non-string input", () => {
        // Arrange
        const object = { test: "value" };

        // Act
        const result = (variantRepository as any).parseJsonField(object);

        // Assert
        expect(result).toBe(object);
      });
    });

    describe("prepareVariantCreateData", () => {
      it("should throw an error for invalid input", () => {
        // Act & Assert
        expect(() =>
          (variantRepository as any).prepareVariantCreateData(null),
        ).toThrow("Invalid variant data");
      });

      it("should throw an error when variant content is missing", () => {
        // Arrange
        const invalidVariantDto = {
          ...createMockVariantDto(),
          variantContent: undefined,
        };

        // Act & Assert
        expect(() =>
          (variantRepository as any).prepareVariantCreateData(
            invalidVariantDto,
          ),
        ).toThrow("Variant content is required");
      });

      it("should prepare valid data for create operation", () => {
        // Arrange
        const variantDto = createMockVariantDto();
        const questionId = 1;
        const dataWithQuestionId = { ...variantDto, questionId };

        // Spy on prepareJsonField
        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation((field) => {
            if (field === variantDto.choices) return JSON.stringify(field);
            if (field === variantDto.scoring) return null;
            return undefined;
          });

        // Act
        const result = (variantRepository as any).prepareVariantCreateData(
          dataWithQuestionId,
        );

        // Assert
        expect(result).toEqual({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          createdAt: expect.any(Date),
          choices: JSON.stringify(variantDto.choices),
          scoring: null,
          variantOf: {
            connect: { id: questionId },
          },
        });
      });

      it("should handle errors during preparation", () => {
        // Arrange
        const variantDto = createMockVariantDto();
        const questionId = 1;
        const dataWithQuestionId = { ...variantDto, questionId };

        const error = new Error("Processing error");
        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation(() => {
            throw error;
          });

        // Act & Assert
        expect(() =>
          (variantRepository as any).prepareVariantCreateData(
            dataWithQuestionId,
          ),
        ).toThrow(error);
      });
    });

    describe("prepareVariantUpdateData", () => {
      it("should throw an error for invalid input", () => {
        // Act & Assert
        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(null),
        ).toThrow("Invalid variant data");
      });

      it("should throw an error when variant content is missing", () => {
        // Arrange
        const invalidVariantDto = {
          ...createMockVariantDto(),
          variantContent: undefined,
        };

        // Act & Assert
        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(
            invalidVariantDto,
          ),
        ).toThrow("Variant content is required");
      });

      it("should prepare valid data for update operation", () => {
        // Arrange
        const variantDto = createMockVariantDto();

        // Spy on prepareJsonField
        jest
          .spyOn<any, any>(variantRepository, "prepareJsonField")
          .mockImplementation((field) => {
            if (field === variantDto.choices) return JSON.stringify(field);
            if (field === variantDto.scoring) return null;
            return undefined;
          });

        // Act
        const result = (variantRepository as any).prepareVariantUpdateData(
          variantDto,
        );

        // Assert
        expect(result).toEqual({
          variantContent: variantDto.variantContent,
          maxWords: variantDto.maxWords,
          maxCharacters: variantDto.maxCharacters,
          randomizedChoices: variantDto.randomizedChoices,
          variantType: variantDto.variantType,
          choices: JSON.stringify(variantDto.choices),
          scoring: null,
        });
      });

      it("should handle errors during preparation", () => {
        // Arrange
        const variantDto = createMockVariantDto();

        const error = new Error("Processing error");
        jest
          .spyOn(variantRepository as any, "prepareJsonField")
          .mockImplementation(() => {
            throw error; // simulate the failure path
          });

        // Act & Assert  ⟵  Jest intercepts the throw, so nothing leaks to the console
        expect(() =>
          (variantRepository as any).prepareVariantUpdateData(variantDto),
        ).toThrow(error);
      });
    });
  });
});
