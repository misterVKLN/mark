/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "src/prisma.service";
import { ReportType } from "@prisma/client";
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ReportService } from "../../../services/report.repository";
import {
  createMockPrismaService,
  createMockAssignment,
  createMockReport,
} from "../__mocks__/ common-mocks";

describe("ReportService", () => {
  let service: ReportService;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    // Create a mock PrismaService
    const mockPrismaService = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    prismaService = module.get(PrismaService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createReport", () => {
    const reportParameters = {
      assignmentId: 1,
      issueType: ReportType.BUG,
      description: "Test description",
      userId: "author-123",
    };

    it("should create a report successfully", async () => {
      // Setup mocks
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        createMockAssignment(),
      );
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([]);

      const createSpy = jest.spyOn(prismaService.report, "create");

      // Call the method
      await service.createReport(
        reportParameters.assignmentId,
        reportParameters.issueType,
        reportParameters.description,
        reportParameters.userId,
      );

      // Verify assignment was checked
      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: reportParameters.assignmentId },
      });

      // Verify rate limit check
      expect(prismaService.report.findMany).toHaveBeenCalledWith({
        where: {
          reporterId: reportParameters.userId,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });

      // Verify report was created
      expect(createSpy).toHaveBeenCalledWith({
        data: {
          assignmentId: reportParameters.assignmentId,
          issueType: reportParameters.issueType,
          description: reportParameters.description,
          reporterId: reportParameters.userId,
          author: true,
        },
      });
    });

    it("should throw NotFoundException when assignment does not exist", async () => {
      // Setup mock to return null for assignment
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        null,
      );

      // Call the method and expect it to throw
      await expect(
        service.createReport(
          reportParameters.assignmentId,
          reportParameters.issueType,
          reportParameters.description,
          reportParameters.userId,
        ),
      ).rejects.toThrow(NotFoundException);

      // Verify assignment was checked
      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: reportParameters.assignmentId },
      });
    });

    it("should throw UnprocessableEntityException when rate limit is exceeded", async () => {
      // Setup mocks
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        createMockAssignment(),
      );

      // Return 5 reports to trigger rate limit
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
      ]);

      // Call the method and expect it to throw
      await expect(
        service.createReport(
          reportParameters.assignmentId,
          reportParameters.issueType,
          reportParameters.description,
          reportParameters.userId,
        ),
      ).rejects.toThrow(UnprocessableEntityException);

      // Verify rate limit was checked
      expect(prismaService.report.findMany).toHaveBeenCalledWith({
        where: {
          reporterId: reportParameters.userId,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
    });
  });

  describe("validateReportInputs", () => {
    it("should throw BadRequestException when issue type is missing", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(null, "Description", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when description is missing", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when issue type is invalid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs("INVALID_TYPE", "Description", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when user ID is invalid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "Description", "");
      }).toThrow(BadRequestException);
    });

    it("should not throw when all inputs are valid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "Description", "user-123");
      }).not.toThrow();
    });
  });

  describe("checkRateLimit", () => {
    it("should not throw when user has not reached the rate limit", async () => {
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
      ]);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);
      await expect(checkRateLimit("user-123")).resolves.not.toThrow();
    });

    it("should throw UnprocessableEntityException when user has reached the rate limit", async () => {
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
      ]);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);
      await expect(checkRateLimit("user-123")).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
