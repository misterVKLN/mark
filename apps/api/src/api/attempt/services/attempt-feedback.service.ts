import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";

@Injectable()
export class AttemptFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit feedback for an assignment attempt
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param feedbackDto Feedback data
   * @param userSession User session information
   * @returns Promise with feedback response
   */
  async submitFeedback(
    assignmentId: number,
    attemptId: number,
    feedbackDto: AssignmentFeedbackDto,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackResponseDto> {
    // Validate the attempt exists
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    // Ensure assignment ID matches
    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    // Ensure user has permission for this attempt
    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to submit feedback for this attempt.",
      );
    }

    // Check for existing feedback
    const existingFeedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (existingFeedback) {
      // Update existing feedback
      const updatedFeedback = await this.prisma.assignmentFeedback.update({
        where: { id: existingFeedback.id },
        data: {
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        id: updatedFeedback.id,
      };
    } else {
      // Create new feedback
      const feedback = await this.prisma.assignmentFeedback.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
        },
      });

      return {
        success: true,
        id: feedback.id,
      };
    }
  }

  /**
   * Get feedback for an assignment attempt
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param userSession User session information
   * @returns Promise with feedback data
   */
  async getFeedback(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackDto> {
    const feedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (!feedback) {
      // Return empty feedback object if none exists
      return {
        comments: "",
        aiGradingRating: undefined,
        assignmentRating: undefined,
      };
    }

    return {
      comments: feedback.comments,
      aiGradingRating: feedback.aiGradingRating,
      assignmentRating: feedback.assignmentRating,
    };
  }
}
