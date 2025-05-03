// src/llm/core/services/usage-tracker.service.ts
import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Inject } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
import { Logger } from "winston";

@Injectable()
export class UsageTrackerService implements IUsageTracker {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: UsageTrackerService.name });
  }

  /**
   * Track LLM usage for a specific assignment and usage type
   * Stores token counts and increments usage count
   */
  async trackUsage(
    assignmentId: number,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    try {
      // Ensure that the assignment exists
      const assignmentExists = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
      });

      if (!assignmentExists) {
        throw new HttpException(
          `Assignment with ID ${assignmentId} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Track usage using upsert to handle both new and existing records
      await this.prisma.aIUsage.upsert({
        where: {
          assignmentId_usageType: {
            assignmentId,
            usageType,
          },
        },
        update: {
          tokensIn: { increment: tokensIn },
          tokensOut: { increment: tokensOut },
          usageCount: { increment: 1 },
          updatedAt: new Date(),
        },
        create: {
          assignmentId,
          usageType,
          tokensIn,
          tokensOut,
          usageCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      this.logger.debug(
        `Tracked usage for assignment ${assignmentId}: ${tokensIn} in, ${tokensOut} out (${usageType})`,
      );
    } catch (error) {
      // Special handling for our own HttpExceptions
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to track AI usage: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Failed to track AI usage",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
