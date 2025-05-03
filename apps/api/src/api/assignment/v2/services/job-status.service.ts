/* eslint-disable unicorn/no-null */
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "@prisma/client";
import {
  catchError,
  concatWith,
  finalize,
  map,
  Observable,
  of,
  Subject,
} from "rxjs";
import { PrismaService } from "src/prisma.service";

interface JobStatus {
  status: string;
  progress: string;
  percentage?: number;
  result?: any;
}

@Injectable()
export class JobStatusServiceV2 {
  private readonly logger = new Logger(JobStatusServiceV2.name);
  private jobStatusStreams = new Map<number, Subject<MessageEvent>>();

  constructor(private readonly prisma: PrismaService) {}

  async createJob(assignmentId: number, userId: string): Promise<Job> {
    return this.prisma.job.create({
      data: {
        assignmentId,
        userId,
        status: "Pending",
        progress: "Job created",
      },
    });
  }

  async createPublishJob(assignmentId: number, userId: string): Promise<Job> {
    return this.prisma.publishJob.create({
      data: {
        assignmentId,
        userId,
        status: "In Progress",
        progress: "Initializing assignment publishing...",
      },
    });
  }

  async getJobStatus(jobId: number): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: { id: jobId },
    });
  }
  getPublishJobStatusStream(jobId: number): Observable<MessageEvent> {
    if (!this.jobStatusStreams.has(jobId)) {
      this.jobStatusStreams.set(jobId, new Subject<MessageEvent>());
    }

    const statusSubject = this.jobStatusStreams.get(jobId);
    if (!statusSubject) {
      throw new Error(`Job status stream for jobId ${jobId} not found.`);
    }

    return of(null).pipe(
      map(() => {
        return {
          type: "update",
          data: { message: "Connecting to job status stream..." },
        } as MessageEvent;
      }),
      concatWith(statusSubject.asObservable()),
      finalize(() => {
        this.logger.log(`Stream closed for job ${jobId}`);
        void this.cleanupJobStream(jobId);
      }),
      catchError((error: Error) => {
        this.logger.error(
          `Stream error for job ${jobId}: ${error.message}`,
          error.stack,
        );
        return of({
          type: "error",
          data: {
            error: error.message,
            done: true,
          },
        } as MessageEvent);
      }),
    );
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async cleanupJobStream(jobId: number): Promise<void> {
    const subject = this.jobStatusStreams.get(jobId);
    if (subject) {
      subject.complete();
      this.jobStatusStreams.delete(jobId);
    }
  }
  async updateJobStatus(jobId: number, statusUpdate: JobStatus): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      this.logger.log(
        `[${timestamp}] Updating job #${jobId} status: ${statusUpdate.status} - ${statusUpdate.progress} (${statusUpdate.percentage}%)`,
      );

      const isPublishJob = Boolean(
        await this.prisma.publishJob.findUnique({
          where: { id: jobId },
        }),
      );

      const sanitizedProgress = statusUpdate.progress
        ? statusUpdate.progress.slice(0, 255)
        : "Status update";

      const validPercentage =
        statusUpdate.percentage === undefined
          ? undefined
          : Math.max(0, Math.min(100, statusUpdate.percentage));

      const maxRetries = 3;
      let attempt = 0;
      let success = false;

      while (attempt < maxRetries && !success) {
        try {
          // Update database based on job type
          await (isPublishJob
            ? this.prisma.publishJob.update({
                where: { id: jobId },
                data: {
                  status: statusUpdate.status,
                  progress: sanitizedProgress,
                  percentage: validPercentage,
                  result: statusUpdate.result
                    ? JSON.stringify(statusUpdate.result)
                    : undefined,
                  updatedAt: new Date(),
                },
              })
            : this.prisma.job.update({
                where: { id: jobId },
                data: {
                  status: statusUpdate.status,
                  progress: sanitizedProgress,
                  result: statusUpdate.result
                    ? JSON.stringify(statusUpdate.result)
                    : undefined,
                  updatedAt: new Date(),
                },
              }));
          success = true;
        } catch (error: unknown) {
          attempt++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (attempt >= maxRetries) {
            this.logger.error(
              `Failed to update job #${jobId} status after ${maxRetries} attempts: ${errorMessage}`,
            );
          } else {
            this.logger.warn(
              `Failed to update job #${jobId} status (attempt ${attempt}/${maxRetries}): ${errorMessage}`,
            );
            // Add exponential backoff between retries
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * Math.pow(2, attempt)),
            );
          }
        }
      }

      // Emit status update for real-time subscribers even if DB update fails
      this.emitJobStatusUpdate(jobId, {
        ...statusUpdate,
        progress: sanitizedProgress,
        percentage: validPercentage,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error in updateJobStatus for job #${jobId}: ${errorMessage}`,
      );

      // Try to notify clients of the error
      const errorStatus: JobStatus = {
        status: "In Progress", // Don't mark as failed to allow recovery
        progress: `Update error: ${errorMessage.slice(0, 100)}... (continuing)`,
        percentage: statusUpdate.percentage,
      };

      this.emitJobStatusUpdate(jobId, errorStatus);
    }
  }

  /**
   * Emit job status update with improved error handling and more detailed events
   *
   * @param jobId - The job ID
   * @param statusUpdate - Job status update details
   */
  private emitJobStatusUpdate(jobId: number, statusUpdate: JobStatus): void {
    try {
      const subject = this.jobStatusStreams.get(jobId);
      if (subject) {
        // Determine message type based on status
        let messageType = "update";
        if (statusUpdate.status === "Completed") {
          messageType = "finalize";
        } else if (statusUpdate.status === "Failed") {
          messageType = "error";
        }

        // Include more detailed information in the event data
        const eventData = {
          timestamp: new Date().toISOString(),
          status: statusUpdate.status,
          progress: statusUpdate.progress,
          percentage: statusUpdate.percentage,
          result:
            statusUpdate.result === undefined
              ? undefined
              : JSON.stringify(statusUpdate.result),
          done:
            statusUpdate.status === "Completed" ||
            statusUpdate.status === "Failed",
        };

        // Emit the status update
        subject.next({
          type: messageType,
          data: eventData,
        } as unknown as MessageEvent);

        // If the job is done, send a final message and close the stream
        if (
          statusUpdate.status === "Completed" ||
          statusUpdate.status === "Failed"
        ) {
          // Send a summary message
          subject.next({
            type: "summary",
            data: {
              message: `Job ${statusUpdate.status.toLowerCase()}`,
              finalStatus: statusUpdate.status,
              duration: "Job duration information would be calculated here", // Would need start time to calculate
            },
          } as unknown as MessageEvent);

          // Close message
          subject.next({
            type: "close",
            data: { message: "Stream completed" },
          } as unknown as MessageEvent);

          // Clean up after a short delay to ensure the message is sent
          setTimeout(() => {
            void this.cleanupJobStream(jobId);
          }, 1000);
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error emitting status update for job #${jobId}: ${errorMessage}`,
      );
    }
  }
}
