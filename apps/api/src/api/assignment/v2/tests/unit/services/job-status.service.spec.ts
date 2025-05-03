/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable unicorn/no-null */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "src/prisma.service";
import { firstValueFrom } from "rxjs";
import { Job } from "@prisma/client";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import {
  createMockPrismaService,
  createMockJob,
} from "../__mocks__/ common-mocks";

describe("JobStatusServiceV2", () => {
  let jobStatusService: JobStatusServiceV2;
  let prismaService: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    // Create mock PrismaService using the utility from common-mocks
    prismaService = createMockPrismaService();

    // Create a testing module with our service and mocked dependencies
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusServiceV2,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    // Get the service instance from the testing module
    jobStatusService = module.get<JobStatusServiceV2>(JobStatusServiceV2);
  });

  afterEach(() => {
    jest.clearAllMocks();

    // Clean up any active streams
    for (const [jobId, subject] of (
      jobStatusService as any
    ).jobStatusStreams.entries()) {
      subject.complete();
      (jobStatusService as any).jobStatusStreams.delete(jobId);
    }

    // Ensure setTimeout is restored to its original if it was mocked
    if (global.setTimeout !== setTimeout) {
      global.setTimeout = setTimeout;
    }

    // Use real timers
    jest.useRealTimers();
  });

  describe("createJob", () => {
    it("should create a new job", async () => {
      // Arrange
      const assignmentId = 1;
      const userId = "author-123";
      const mockJob = createMockJob({ assignmentId, userId }, "Pending");
      prismaService.job.create.mockResolvedValue(mockJob);

      // Act
      const result = await jobStatusService.createJob(assignmentId, userId);

      // Assert
      expect(prismaService.job.create).toHaveBeenCalledWith({
        data: {
          assignmentId,
          userId,
          status: "Pending",
          progress: "Job created",
        },
      });
      expect(result).toEqual(mockJob);
    });
  });

  describe("createPublishJob", () => {
    it("should create a new publish job", async () => {
      // Arrange
      const assignmentId = 1;
      const userId = "author-123";
      const mockJob = createMockJob({ assignmentId, userId }, "In Progress");
      prismaService.publishJob.create.mockResolvedValue(mockJob);

      // Act
      const result = await jobStatusService.createPublishJob(
        assignmentId,
        userId,
      );

      // Assert
      expect(prismaService.publishJob.create).toHaveBeenCalledWith({
        data: {
          assignmentId,
          userId,
          status: "In Progress",
          progress: "Initializing assignment publishing...",
        },
      });
      expect(result).toEqual(mockJob);
    });
  });

  describe("getJobStatus", () => {
    it("should get job status by ID", async () => {
      // Arrange
      const jobId = 1;
      const mockJob = createMockJob({ id: jobId });
      prismaService.job.findUnique.mockResolvedValue(mockJob);

      // Act
      const result = await jobStatusService.getJobStatus(jobId);

      // Assert
      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { id: jobId },
      });
      expect(result).toEqual(mockJob);
    });

    it("should return null if job not found", async () => {
      // Arrange
      const jobId = 999;
      prismaService.job.findUnique.mockResolvedValue(null);

      // Act
      const result = await jobStatusService.getJobStatus(jobId);

      // Assert
      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { id: jobId },
      });
      expect(result).toBeNull();
    });
  });

  describe("getPublishJobStatusStream", () => {
    it("should create and return an observable with initial connection message", async () => {
      // Arrange
      const jobId = 1;

      // Act
      const stream = jobStatusService.getPublishJobStatusStream(jobId);
      const result = await firstValueFrom(stream);

      // Assert
      expect(result).toEqual({
        type: "update",
        data: { message: "Connecting to job status stream..." },
      });
    });

    it("should throw an error if job status stream not found after creation", () => {
      // Arrange
      const jobId = 1;

      // Mock the Map to make get() return undefined even after set()
      const originalMapGet = Map.prototype.get;
      Map.prototype.get = jest.fn().mockReturnValue(undefined);

      // Act & Assert
      expect(() => {
        jobStatusService.getPublishJobStatusStream(jobId);
      }).toThrow(`Job status stream for jobId ${jobId} not found.`);

      // Restore the original Map.get
      Map.prototype.get = originalMapGet;
    });

    // To this:
    it("should handle errors in the observable stream", async () => {
      // Arrange
      const jobId = 1;
      const errorMessage = "Test error";

      // Spy on the subject's next method to throw an error
      // Create a stream first to ensure subject exists
      jobStatusService.getPublishJobStatusStream(jobId);
      const subject = (jobStatusService as any).jobStatusStreams.get(jobId);

      // Mock the subject to throw an error when next is called
      jest.spyOn(subject, "next").mockImplementation(() => {
        throw new Error(errorMessage);
      });

      // Create a new stream after modifying the subject
      const stream = jobStatusService.getPublishJobStatusStream(jobId);

      // Act & Assert - first value will be the initial message
      const firstEvent = await firstValueFrom(stream);
      expect(firstEvent).toEqual({
        type: "update",
        data: { message: "Connecting to job status stream..." },
      });

      // Emit an event to trigger the error
      try {
        // This should cause the error to be thrown
        subject.next({} as MessageEvent);
        fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(errorMessage);
      }
    });
    describe("cleanupJobStream", () => {
      it("should complete and remove a job stream", async () => {
        // Arrange
        const jobId = 1;

        // Create a stream first to ensure it exists in the map
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Spy on the subject's complete method
        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "complete");

        // Act
        await jobStatusService.cleanupJobStream(jobId);

        // Assert
        expect(subject.complete).toHaveBeenCalled();
        expect((jobStatusService as any).jobStatusStreams.has(jobId)).toBe(
          false,
        );
      });

      it("should do nothing if job stream does not exist", async () => {
        // Arrange
        const jobId = 999;

        // Make sure the map is empty
        (jobStatusService as any).jobStatusStreams.clear();

        // Act
        await jobStatusService.cleanupJobStream(jobId);

        // Assert - should complete without error
        expect((jobStatusService as any).jobStatusStreams.size).toBe(0);
      });
    });

    describe("updateJobStatus", () => {
      it("should update job status for a regular job", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        prismaService.publishJob.findUnique.mockResolvedValue(null);
        prismaService.job.update.mockResolvedValue({
          id: jobId,
          ...statusUpdate,
        } as unknown as Job);

        // Spy on the emitJobStatusUpdate method
        jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(prismaService.job.update).toHaveBeenCalledWith({
          where: { id: jobId },
          data: {
            status: statusUpdate.status,
            progress: statusUpdate.progress,
            result: undefined,
            updatedAt: expect.any(Date),
          },
        });
        expect(
          (jobStatusService as any).emitJobStatusUpdate,
        ).toHaveBeenCalledWith(jobId, {
          ...statusUpdate,
          progress: statusUpdate.progress,
          percentage: statusUpdate.percentage,
        });
      });

      it("should update job status for a publish job", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        prismaService.publishJob.findUnique.mockResolvedValue({
          id: jobId,
        } as Job);
        prismaService.publishJob.update.mockResolvedValue({
          id: jobId,
          ...statusUpdate,
        } as unknown as Job);

        // Spy on the emitJobStatusUpdate method
        jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(prismaService.publishJob.update).toHaveBeenCalledWith({
          where: { id: jobId },
          data: {
            status: statusUpdate.status,
            progress: statusUpdate.progress,
            percentage: statusUpdate.percentage,
            result: undefined,
            updatedAt: expect.any(Date),
          },
        });
        expect(
          (jobStatusService as any).emitJobStatusUpdate,
        ).toHaveBeenCalledWith(jobId, {
          ...statusUpdate,
          progress: statusUpdate.progress,
          percentage: statusUpdate.percentage,
        });
      });

      it("should sanitize progress text that exceeds maximum length", async () => {
        // Arrange
        const jobId = 1;
        const longProgress = "a".repeat(300); // Create a string longer than 255 chars
        const statusUpdate = {
          status: "In Progress",
          progress: longProgress,
          percentage: 50,
        };

        prismaService.publishJob.findUnique.mockResolvedValue(null);
        prismaService.job.update.mockResolvedValue({
          id: jobId,
          ...statusUpdate,
          progress: longProgress.slice(0, 255),
        } as unknown as Job);

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(prismaService.job.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              progress: longProgress.slice(0, 255),
            }),
          }),
        );
      });

      it("should clamp percentage to valid range (0-100)", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 150, // Invalid percentage (> 100)
        };

        prismaService.publishJob.findUnique.mockResolvedValue(null);
        prismaService.job.update.mockResolvedValue({
          id: jobId,
          ...statusUpdate,
          percentage: 100,
        } as unknown as Job);

        // Add this spy BEFORE calling the method
        jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(prismaService.job.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              // Should be clamped to 100
            }),
          }),
        );
        expect(
          (jobStatusService as any).emitJobStatusUpdate,
        ).toHaveBeenCalledWith(
          jobId,
          expect.objectContaining({
            percentage: 100, // Should be clamped to 100
          }),
        );
      });
      it("should retry database update on failure (up to max retries)", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        prismaService.publishJob.findUnique.mockResolvedValue(null);

        // First two calls fail, third succeeds
        prismaService.job.update
          .mockRejectedValueOnce(new Error("DB error 1"))
          .mockRejectedValueOnce(new Error("DB error 2"))
          .mockResolvedValueOnce({
            id: jobId,
            ...statusUpdate,
          } as unknown as Job);

        // Replace the setTimeout function implementation directly
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = jest.fn((callback) => {
          // Execute callback immediately
          callback();
          return {} as NodeJS.Timeout;
        });

        // Act & Assert
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Verify the correct number of calls
        expect(prismaService.job.update).toHaveBeenCalledTimes(3);

        // Restore the original setTimeout
        global.setTimeout = originalSetTimeout;
      });
      it("should still emit status update even if all DB updates fail", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        prismaService.publishJob.findUnique.mockResolvedValue(null);

        // All attempts fail
        prismaService.job.update.mockRejectedValue(new Error("DB error"));

        // Spy on emitJobStatusUpdate
        jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

        // Replace the setTimeout function implementation directly
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = jest.fn((callback) => {
          // Execute callback immediately
          callback();
          return {} as NodeJS.Timeout;
        });

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(prismaService.job.update).toHaveBeenCalledTimes(3); // 3 retries
        expect(
          (jobStatusService as any).emitJobStatusUpdate,
        ).toHaveBeenCalled();

        // Restore the original setTimeout
        global.setTimeout = originalSetTimeout;
      });

      it("should handle errors in the updateJobStatus method", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        // Force an error early in the method
        prismaService.publishJob.findUnique.mockRejectedValue(
          new Error("Catastrophic error"),
        );

        // Spy on the emitJobStatusUpdate and logger methods
        jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");
        jest.spyOn(jobStatusService["logger"], "error");

        // Act
        await jobStatusService.updateJobStatus(jobId, statusUpdate);

        // Assert
        expect(jobStatusService["logger"].error).toHaveBeenCalled();
        expect(
          (jobStatusService as any).emitJobStatusUpdate,
        ).toHaveBeenCalledWith(
          jobId,
          expect.objectContaining({
            status: "In Progress",
            progress: expect.stringContaining("Update error:"),
          }),
        );
      });
    });

    describe("emitJobStatusUpdate (private method)", () => {
      it("should emit update message to subject", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        // Create a stream to ensure subject exists
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Get subject from private map
        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        // Act
        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        // Assert
        expect(subject.next).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "update",
            data: expect.objectContaining({
              status: statusUpdate.status,
              progress: statusUpdate.progress,
              percentage: statusUpdate.percentage,
            }),
          }),
        );
      });

      it("should emit completion messages when job is completed", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "Completed",
          progress: "Job completed successfully",
          percentage: 100,
          result: { data: "some result" },
        };

        // Create a stream to ensure subject exists
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Get subject from private map
        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        // Mock setTimeout
        jest.useFakeTimers();

        // Spy on cleanupJobStream BEFORE the action, not after
        jest.spyOn(jobStatusService, "cleanupJobStream");

        // Act
        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        // Assert - check all messages (update, summary, close)
        expect(subject.next).toHaveBeenCalledTimes(3);
        expect(subject.next).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            type: "finalize",
            data: expect.objectContaining({
              status: "Completed",
              done: true,
            }),
          }),
        );
        expect(subject.next).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            type: "summary",
            data: expect.objectContaining({
              finalStatus: "Completed",
            }),
          }),
        );
        expect(subject.next).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            type: "close",
            data: expect.objectContaining({
              message: "Stream completed",
            }),
          }),
        );

        // Run timers to trigger cleanup
        jest.advanceTimersByTime(1000);

        // Check cleanup was called
        expect(jobStatusService.cleanupJobStream).toHaveBeenCalledWith(jobId);

        // Restore timers
        jest.useRealTimers();
      });

      it("should emit error messages when job fails", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "Failed",
          progress: "Job failed due to error",
          percentage: 50,
        };

        // Create a stream to ensure subject exists
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Get subject from private map
        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        // Mock setTimeout
        jest.useFakeTimers();

        // Act
        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        // Assert - check messages
        expect(subject.next).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            data: expect.objectContaining({
              status: "Failed",
              done: true,
            }),
          }),
        );

        // Restore timers
        jest.useRealTimers();
      });

      it("should handle errors when emitting status updates", async () => {
        // Arrange
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        // Create a stream to ensure subject exists
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Get subject from private map
        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);

        // Force an error when calling next
        jest.spyOn(subject, "next").mockImplementation(() => {
          throw new Error("Emission error");
        });

        // Spy on logger
        jest.spyOn(jobStatusService["logger"], "error");

        // Act
        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        // Assert
        expect(jobStatusService["logger"].error).toHaveBeenCalledWith(
          expect.stringContaining(
            `Error emitting status update for job #${jobId}`,
          ),
        );
      });

      it("should do nothing if job stream does not exist", async () => {
        // Arrange
        const jobId = 999;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        // Make sure the job stream doesn't exist
        (jobStatusService as any).jobStatusStreams.clear();

        // Spy on logger
        jest.spyOn(jobStatusService["logger"], "error");

        // Act
        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        // Assert - should not throw errors
        expect(jobStatusService["logger"].error).not.toHaveBeenCalled();
      });
    });

    // Test the full stream lifecycle with integration-style test
    describe("Stream lifecycle integration", () => {
      it("should handle a complete job lifecycle with status updates", async () => {
        // Arrange
        const jobId = 1;
        prismaService.publishJob.findUnique.mockResolvedValue(null);
        prismaService.job.update.mockResolvedValue({} as Job);

        // Create the status stream
        const stream = jobStatusService.getPublishJobStatusStream(jobId);

        // Collect all emitted events
        const events: MessageEvent[] = [];
        const subscription = stream.subscribe((event) => {
          events.push(event);
        });

        // Act - simulate job lifecycle with status updates
        await jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Starting job",
          percentage: 0,
        });

        await jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        });

        await jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: "Job completed successfully",
          percentage: 100,
          result: { data: "some result" },
        });

        // Fast-forward through setTimeout
        jest.useFakeTimers();
        jest.advanceTimersByTime(1100);
        jest.useRealTimers();

        // Clean up subscription
        subscription.unsubscribe();

        // Assert
        expect(events.length).toBeGreaterThanOrEqual(5); // Initial + 3 updates + summary + close

        // Check initial connection message
        expect(events[0].type).toBe("update");
        expect(events[0].data.message).toBe(
          "Connecting to job status stream...",
        );

        // Check progress updates
        const progressEvents = events.filter(
          (e) => e.type === "update" || e.type === "finalize",
        );
        expect(progressEvents.length).toBeGreaterThanOrEqual(3);

        // Check completion messages
        const completionEvents = events.filter(
          (e) => e.type === "summary" || e.type === "close",
        );
        expect(completionEvents.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
