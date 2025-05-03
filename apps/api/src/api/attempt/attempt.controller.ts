import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AttemptServiceV2 } from "./services/attempt.service";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { Roles } from "src/auth/role/roles.global.guard";
import {
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  GRADE_SUBMISSION_EXCEPTION,
} from "../assignment/attempt/api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "../assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentFeedbackResponseDto,
  AssignmentFeedbackDto,
  RequestRegradingResponseDto,
  RegradingRequestDto,
  RegradingStatusResponseDto,
} from "../assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "../assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { ReportRequestDTO } from "../assignment/attempt/dto/assignment-attempt/post.assignment.report.dto";
import { UpdateAssignmentAttemptResponseDto } from "../assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";

@ApiTags("Attempts")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/attempts",
  version: "2",
})
export class AttemptControllerV2 {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly attemptService: AttemptServiceV2,
  ) {
    this.logger = parentLogger.child({ context: AttemptControllerV2.name });
  }

  @Post()
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Create an assignment attempt for an assignment.",
  })
  @ApiResponse({ status: 201, type: BaseAssignmentAttemptResponseDto })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({ status: 403 })
  createAssignmentAttempt(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    return this.attemptService.createAssignmentAttempt(
      Number(assignmentId),
      request.userSession,
    );
  }

  @Get()
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "List assignment attempts for an assignment." })
  @ApiResponse({ status: 200, type: [AssignmentAttemptResponseDto] })
  @ApiResponse({ status: 403 })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 500,
    type: String,
    description: GRADE_SUBMISSION_EXCEPTION,
  })
  listAssignmentAttempts(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentAttemptResponseDto[]> {
    return this.attemptService.listAssignmentAttempts(
      Number(assignmentId),
      request.userSession,
    );
  }

  @Get(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Query("lang") lang?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getAssignmentAttempt(
      Number(assignmentAttemptId),
      lang,
    );
  }

  @Get(":attemptId/completed")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getLearnerAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getLearnerAssignmentAttempt(
      Number(assignmentAttemptId),
    );
  }

  @Patch(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Update an assignment attempt for an assignment.",
  })
  @ApiBody({
    type: LearnerUpdateAssignmentAttemptRequestDto,
    required: true,
  })
  @ApiResponse({ status: 201, type: BaseAssignmentAttemptResponseDto })
  @ApiResponse({
    status: 422,
    type: String,
    description: SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 500,
    type: String,
    description: GRADE_SUBMISSION_EXCEPTION,
  })
  @ApiResponse({ status: 403 })
  async updateAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    learnerUpdateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    // The authentication cookie is used for LTI grade callbacks
    const authCookie: string =
      typeof request?.cookies?.authentication === "string"
        ? request.cookies.authentication
        : "";
    const gradingCallbackRequired =
      request?.userSession.gradingCallbackRequired ?? false;
    return this.attemptService.updateAssignmentAttempt(
      Number(assignmentAttemptId),
      Number(assignmentId),
      learnerUpdateAssignmentAttemptDto,
      authCookie,
      gradingCallbackRequired,
      request,
    );
  }

  @Post(":attemptId/feedback")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Submit feedback for an assignment attempt." })
  @ApiResponse({ status: 201, type: AssignmentFeedbackResponseDto })
  @ApiResponse({ status: 400, description: "Bad Request" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  submitFeedback(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Body() body: { feedback: AssignmentFeedbackDto },
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackResponseDto> {
    const feedbackDto = body.feedback;
    return this.attemptService.submitFeedback(
      Number(assignmentId),
      Number(attemptId),
      feedbackDto,
      request.userSession,
    );
  }

  @Get(":attemptId/feedback")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get feedback for an assignment attempt." })
  @ApiResponse({ status: 200, type: AssignmentFeedbackDto })
  @ApiResponse({ status: 403 })
  getFeedback(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackDto> {
    return this.attemptService.getFeedback(
      Number(assignmentId),
      Number(attemptId),
      request.userSession,
    );
  }

  @Post(":attemptId/regrade")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Request regrading for an assignment attempt." })
  @ApiResponse({ status: 201, type: RequestRegradingResponseDto })
  @ApiResponse({ status: 403 })
  processRegradingRequest(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Body() body: { regradingRequest: RegradingRequestDto },
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackResponseDto> {
    return this.attemptService.processRegradingRequest(
      Number(assignmentId),
      Number(attemptId),
      body.regradingRequest,
      request.userSession,
    );
  }

  @Get(":attemptId/regrade")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get regrading status for an assignment attempt." })
  @ApiResponse({ status: 200, type: RegradingStatusResponseDto })
  @ApiResponse({ status: 403 })
  getRegradingStatus(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Req() request: UserSessionRequest,
  ): Promise<RegradingStatusResponseDto> {
    return this.attemptService.getRegradingStatus(
      Number(assignmentId),
      Number(attemptId),
      request.userSession,
    );
  }

  @Post(":attemptId/report")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @ApiOperation({ summary: "Submit a report for an assignment" })
  @ApiParam({
    name: "assignmentId",
    required: true,
    description: "ID of the assignment",
  })
  @ApiBody({
    description: "Report details",
    type: ReportRequestDTO,
  })
  @ApiResponse({ status: 201, description: "Report submitted successfully" })
  @ApiResponse({ status: 400, description: "Invalid input or missing fields" })
  @ApiResponse({ status: 403 })
  async submitReport(
    @Param("attemptId") attemptId: number,
    @Param("assignmentId") assignmentId: number,
    @Body() body: ReportRequestDTO,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string }> {
    const { issueType, description } = body;

    // Validate input
    if (!issueType || !description) {
      throw new BadRequestException("Issue type and description are required");
    }

    const validIssueTypes = Object.values(ReportType);
    if (!validIssueTypes.includes(issueType)) {
      throw new BadRequestException("Invalid issue type");
    }

    const userId = request.userSession.userId;
    if (!userId || userId.trim() === "") {
      throw new BadRequestException("Invalid user ID");
    }

    // Create the report
    await this.attemptService.createReport(
      Number(assignmentId),
      Number(attemptId),
      issueType,
      description,
      userId,
    );

    return { message: "Report submitted successfully" };
  }
}
