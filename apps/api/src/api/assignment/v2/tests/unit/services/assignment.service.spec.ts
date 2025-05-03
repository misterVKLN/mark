/* eslint-disable unicorn/no-array-push-push */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/prisma.service";

import { QuestionType, VariantType } from "@prisma/client";

import { QuestionService } from "src/api/assignment/v2/services/question.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";

import { UpdateAssignmentRequestDto } from "src/api/assignment/dto/update.assignment.request.dto";
import { UpdateAssignmentQuestionsDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AssignmentRepository } from "../../../repositories/assignment.repository";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import { TranslationService } from "../../../services/translation.service";
import {
  createMockAssignmentRepository,
  createMockQuestionService,
  createMockTranslationService,
  createMockJobStatusService,
  createMockLogger,
  createMockLlmFacadeService,
  createMockPrismaService,
  createMockLearnerGetAssignmentResponseDto,
  sampleLearnerSession,
  createMockGetAssignmentResponseDto,
  sampleAuthorSession,
  createMockAssignmentResponseDto,
  createMockUpdateAssignmentDto,
  createMockReplaceAssignmentDto,
  createMockUpdateAssignmentQuestionsDto,
  createMockQuestionDto,
} from "../__mocks__/ common-mocks";
import { AssignmentServiceV2 } from "../../../services/assignment.service";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Test-suite                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe("AssignmentServiceV2 – full unit-suite", () => {
  let service: AssignmentServiceV2;
  let assignmentRepository: ReturnType<typeof createMockAssignmentRepository>;
  let questionService: ReturnType<typeof createMockQuestionService>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;
  let logger: ReturnType<typeof createMockLogger>;

  /* ---------------------------------------------------------------------- */
  /*  Test module setup                                                     */
  /* ---------------------------------------------------------------------- */
  beforeEach(async () => {
    assignmentRepository = createMockAssignmentRepository();
    questionService = createMockQuestionService();
    translationService = createMockTranslationService();
    jobStatusService = createMockJobStatusService();
    const llmService = createMockLlmFacadeService();
    logger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentServiceV2,
        { provide: AssignmentRepository, useValue: assignmentRepository },
        { provide: QuestionService, useValue: questionService },
        { provide: TranslationService, useValue: translationService },
        { provide: JobStatusServiceV2, useValue: jobStatusService },
        { provide: LlmFacadeService, useValue: llmService },
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { child: () => logger } },
      ],
    }).compile();

    service = module.get(AssignmentServiceV2);
  });

  afterEach(() => jest.clearAllMocks());

  /* ---------------------------------------------------------------------- */
  /*  Basic existence                                                       */
  /* ---------------------------------------------------------------------- */
  it("service should be defined", () => {
    expect(service).toBeDefined();
  });

  /* ---------------------------------------------------------------------- */
  /*  getAssignment                                                         */
  /* ---------------------------------------------------------------------- */
  describe("getAssignment", () => {
    it("returns learner view without translation", async () => {
      const mockAssignment = createMockLearnerGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      const response = await service.getAssignment(1, sampleLearnerSession);

      expect(response).toEqual(mockAssignment);
      expect(assignmentRepository.findById).toHaveBeenCalledWith(
        1,
        sampleLearnerSession,
      );
      expect(
        translationService.applyTranslationsToAssignment,
      ).not.toHaveBeenCalled();
    });

    it("returns author view without translation", async () => {
      const mockAssignment = createMockGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      const response = await service.getAssignment(1, sampleAuthorSession);

      expect(response).toEqual(mockAssignment);
      expect(assignmentRepository.findById).toHaveBeenCalledWith(
        1,
        sampleAuthorSession,
      );
      expect(
        translationService.applyTranslationsToAssignment,
      ).not.toHaveBeenCalled();
    });

    it("applies translation when languageCode supplied", async () => {
      const mockAssignment = createMockGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      await service.getAssignment(1, sampleAuthorSession, "fr");

      expect(
        translationService.applyTranslationsToAssignment,
      ).toHaveBeenCalledWith(mockAssignment, "fr");
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  listAssignments                                                       */
  /* ---------------------------------------------------------------------- */
  describe("listAssignments", () => {
    it("lists all assignments for a user", async () => {
      const list = [createMockAssignmentResponseDto()];
      assignmentRepository.findAllForUser.mockResolvedValueOnce(list);

      const response = await service.listAssignments(sampleAuthorSession);

      expect(response).toEqual(list);
      expect(assignmentRepository.findAllForUser).toHaveBeenCalledWith(
        sampleAuthorSession,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  updateAssignment                                                      */
  /* ---------------------------------------------------------------------- */
  describe("updateAssignment", () => {
    it("updates & triggers translation and grading-context update", async () => {
      const dto: UpdateAssignmentRequestDto = createMockUpdateAssignmentDto({
        name: "Updated name", // translatable change
      });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(true);

      await service.updateAssignment(1, dto);

      expect(assignmentRepository.update).toHaveBeenCalledWith(1, dto);
      expect(translationService.translateAssignment).toHaveBeenCalledWith(1);
      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        1,
      );
    });

    it("skips translation when non-translatable changes only", async () => {
      const dto = createMockUpdateAssignmentDto({ graded: true });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(false);

      await service.updateAssignment(1, dto);

      expect(translationService.translateAssignment).not.toHaveBeenCalled();
    });

    it("updates grading context when published toggled on", async () => {
      const dto = createMockUpdateAssignmentDto({ published: true });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(false);

      await service.updateAssignment(1, dto);

      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        1,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  replaceAssignment                                                     */
  /* ---------------------------------------------------------------------- */
  describe("replaceAssignment", () => {
    it("replaces assignment entirely", async () => {
      const dto = createMockReplaceAssignmentDto();

      const response = await service.replaceAssignment(1, dto);

      expect(response).toEqual({ id: 1, success: true });
      expect(assignmentRepository.replace).toHaveBeenCalledWith(1, dto);
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  getAvailableLanguages                                                 */
  /* ---------------------------------------------------------------------- */
  describe("getAvailableLanguages", () => {
    it("returns language list", async () => {
      const langs = ["en", "fr", "es"];
      translationService.getAvailableLanguages.mockResolvedValueOnce(langs);

      const response = await service.getAvailableLanguages(1);

      expect(response).toEqual(langs);
      expect(translationService.getAvailableLanguages).toHaveBeenCalledWith(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  publishAssignment                                                     */
  /* ---------------------------------------------------------------------- */
  describe("publishAssignment", () => {
    it("kicks off publishing and returns job info", async () => {
      const dto: UpdateAssignmentQuestionsDto =
        createMockUpdateAssignmentQuestionsDto();

      const spy = jest
        .spyOn<any, any>(service as any, "startPublishingProcess")
        .mockResolvedValue(undefined);

      const response = await service.publishAssignment(1, dto, "author-123");

      expect(jobStatusService.createPublishJob).toHaveBeenCalledWith(
        1,
        "author-123",
      );
      expect(spy).toHaveBeenCalledWith(1, 1, dto); // jobId always 1 in mock
      expect(response).toEqual({ jobId: 1, message: "Publishing started" });
    });

    it("logs an error but still returns jobId if async publish fails", async () => {
      const dto = createMockUpdateAssignmentQuestionsDto();
      jest
        .spyOn<any, any>(service as any, "startPublishingProcess")
        .mockRejectedValue(new Error("fail"));

      const response = await service.publishAssignment(1, dto, "author-123");

      expect(response).toEqual({ jobId: 1, message: "Publishing started" });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  startPublishingProcess – happy path                                   */
  /* ---------------------------------------------------------------------- */
  describe("startPublishingProcess (private) – happy path", () => {
    it("runs all steps when content changes", async () => {
      const assignmentId = 1;
      const jobId = 1;
      const dto = createMockUpdateAssignmentQuestionsDto();

      jest
        .spyOn<
          any,
          any
        >(service as any, "haveTranslatableAssignmentFieldsChanged")
        .mockReturnValue(true);
      jest
        .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
        .mockReturnValue(true);

      await service["startPublishingProcess"](jobId, assignmentId, dto);

      expect(
        questionService.processQuestionsForPublishing,
      ).toHaveBeenCalledWith(assignmentId, dto.questions, jobId);
      expect(translationService.translateAssignment).toHaveBeenCalledWith(
        assignmentId,
        jobId,
      );
      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        assignmentId,
      );
      expect(assignmentRepository.update).toHaveBeenCalledWith(
        assignmentId,
        expect.objectContaining({ published: true }),
      );
      expect(jobStatusService.updateJobStatus).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: "Completed" }),
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  startPublishingProcess – config-only                                  */
  /* ---------------------------------------------------------------------- */
  it("skips translation & grading-context when only configuration changes", async () => {
    const assignmentId = 1;
    const jobId = 1;
    const dto = createMockUpdateAssignmentQuestionsDto({
      graded: true,
      numAttempts: 3,
    });

    // config-only ➜ both helpers return false
    jest
      .spyOn<
        any,
        any
      >(service as any, "haveTranslatableAssignmentFieldsChanged")
      .mockReturnValue(false);
    jest
      .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
      .mockReturnValue(false);

    // make sure the assignment is already published
    const existingAssignment = createMockGetAssignmentResponseDto({
      published: true,
    });
    assignmentRepository.findById.mockResolvedValue(existingAssignment);

    await service["startPublishingProcess"](jobId, assignmentId, dto);

    expect(translationService.translateAssignment).not.toHaveBeenCalled();
    expect(questionService.updateQuestionGradingContext).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------------- */
  /*  haveTranslatableAssignmentFieldsChanged                               */
  /* ---------------------------------------------------------------------- */
  describe("haveTranslatableAssignmentFieldsChanged", () => {
    it.each([
      ["name", { name: "New name" }],
      ["instructions", { instructions: "New inst" }],
      ["introduction", { introduction: "New intro" }],
      ["gradingCriteriaOverview", { gradingCriteriaOverview: "New rubric" }],
    ])("returns true when %s changes", (_, patch) => {
      const existing = createMockGetAssignmentResponseDto();
      const dto = createMockUpdateAssignmentDto(patch);

      expect(
        service["haveTranslatableAssignmentFieldsChanged"](existing, dto),
      ).toBe(true);
    });

    it("returns false when only non-translatable fields change", () => {
      // existing assignment with all translatable strings already set
      const existingAssignment = createMockGetAssignmentResponseDto();

      // DTO touches only NON-translatable props — no name / intro / etc.
      const dto: UpdateAssignmentRequestDto = {
        name: existingAssignment.name,
        introduction: existingAssignment.introduction,
        instructions: existingAssignment.instructions,
        gradingCriteriaOverview: existingAssignment.gradingCriteriaOverview,
        graded: !existingAssignment.graded,
        numAttempts: (existingAssignment.numAttempts ?? 0) + 1,
        passingGrade: (existingAssignment.passingGrade ?? 50) + 5,
        published: existingAssignment.published,
        timeEstimateMinutes: 0,
        attemptsPerTimeRange: 0,
        attemptsTimeRangeHours: 0,
        displayOrder: "DEFINED",
        questionDisplay: "ONE_PER_PAGE",
        questionOrder: [],
        showAssignmentScore: false,
        showQuestionScore: false,
        showSubmissionFeedback: false,
      };

      expect(
        service["haveTranslatableAssignmentFieldsChanged"](
          existingAssignment,
          dto,
        ),
      ).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  haveQuestionContentsChanged                                            */
  /* ---------------------------------------------------------------------- */
  describe("haveQuestionContentsChanged", () => {
    it("detects question count change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects question text change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [createMockQuestionDto({ question: "Different text" })];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects type change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto({}, QuestionType.MULTIPLE_CORRECT),
      ];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects choices change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto({
          choices: [{ ...createMockQuestionDto().choices[0], points: 999 }],
        }),
      ];
      jest
        .spyOn<any, any>(service as any, "areChoicesEqual")
        .mockReturnValue(false);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects variants change", () => {
      const existing = [
        createMockQuestionDto({
          variants: [
            { id: 101, variantContent: "A", variantType: VariantType.REWORDED },
          ],
        }),
      ];
      const updated = [
        createMockQuestionDto({
          variants: [
            { id: 101, variantContent: "B", variantType: VariantType.REWORDED },
          ],
        }),
      ];
      jest
        .spyOn<any, any>(service as any, "haveVariantsChanged")
        .mockReturnValue(true);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("returns false when nothing changes", () => {
      const existing = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      const updated = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      jest
        .spyOn<any, any>(service as any, "areChoicesEqual")
        .mockReturnValue(true);
      jest
        .spyOn<any, any>(service as any, "haveVariantsChanged")
        .mockReturnValue(false);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        false,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  safeStringCompare                                                     */
  /* ---------------------------------------------------------------------- */
  describe("safeStringCompare", () => {
    it.each([
      ["same strings", "hello", "hello", true],
      ["different strings", "hello", "world", false],
      ["null vs undefined", null, undefined, true],
      ["number vs string", 123, "123", true],
      ["boolean vs string", true, "true", true],
    ])("%s", (_, a, b, expected) => {
      return expect(
        service["safeStringCompare"](
          a,
          b as string | number | boolean | null | undefined,
        ),
      ).toBe(expected);
    });
  });
});
