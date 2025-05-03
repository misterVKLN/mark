import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { AttemptFeedbackService } from "./attempt-feedback.service";
import { AttemptRegradingService } from "./attempt-regrading.service";
import { AttemptReportingService } from "./attempt-reporting.service";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { ReportType } from "@prisma/client";
import { BaseAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
  RegradingRequestDto,
  RequestRegradingResponseDto,
  RegradingStatusResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
import { AttemptSubmissionService } from "./attempt-submission.service";

@Injectable()
export class AttemptServiceV2 {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissionService: AttemptSubmissionService,
    private readonly feedbackService: AttemptFeedbackService,
    private readonly regradingService: AttemptRegradingService,
    private readonly reportingService: AttemptReportingService,
  ) {}

  /**
   * Submit feedback for an assignment attempt
   */
  async submitFeedback(
    assignmentId: number,
    attemptId: number,
    feedbackDto: AssignmentFeedbackDto,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackResponseDto> {
    return this.feedbackService.submitFeedback(
      assignmentId,
      attemptId,
      feedbackDto,
      userSession,
    );
  }

  /**
   * Get feedback for an assignment attempt
   */
  async getFeedback(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackDto> {
    return this.feedbackService.getFeedback(
      assignmentId,
      attemptId,
      userSession,
    );
  }

  /**
   * Process a regrading request
   */
  async processRegradingRequest(
    assignmentId: number,
    attemptId: number,
    regradingRequestDto: RegradingRequestDto,
    userSession: UserSession,
  ): Promise<RequestRegradingResponseDto> {
    return this.regradingService.processRegradingRequest(
      assignmentId,
      attemptId,
      regradingRequestDto,
      userSession,
    );
  }

  /**
   * Get regrading status
   */
  async getRegradingStatus(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<RegradingStatusResponseDto> {
    return this.regradingService.getRegradingStatus(
      assignmentId,
      attemptId,
      userSession,
    );
  }

  /**
   * List assignment attempts
   */
  async listAssignmentAttempts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<AssignmentAttemptResponseDto[]> {
    return this.prisma.assignmentAttempt.findMany({
      where:
        userSession.role === UserRole.AUTHOR
          ? { assignmentId }
          : { assignmentId, userId: userSession.userId },
    });
  }

  /**
   * Create an assignment attempt
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    return this.submissionService.createAssignmentAttempt(
      assignmentId,
      userSession,
    );
  }

  /**
   * Update an assignment attempt
   */
  async updateAssignmentAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    return this.submissionService.updateAssignmentAttempt(
      attemptId,
      assignmentId,
      updateDto,
      authCookie,
      gradingCallbackRequired,
      request,
    );
  }

  /**
   * Get a learner assignment attempt
   */
  async getLearnerAssignmentAttempt(
    attemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.submissionService.getLearnerAssignmentAttempt(attemptId);
  }

  /**
   * Get an assignment attempt
   */
  async getAssignmentAttempt(
    attemptId: number,
    language?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.submissionService.getAssignmentAttempt(attemptId, language);
  }

  /**
   * Create a report
   */
  async createReport(
    assignmentId: number,
    attemptId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    return this.reportingService.createReport(
      assignmentId,
      attemptId,
      issueType,
      description,
      userId,
    );
  }
}
