/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { LocalizationService } from "../utils/localization.service";
import { LearnerFileUpload } from "../interfaces/attempt.interface";
import { GradingContext } from "../interfaces/grading-context.interface";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class FileGradingStrategy extends AbstractGradingStrategy<
  LearnerFileUpload[]
> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
  }

  /**
   * Validate that the request contains valid file uploads
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      !requestDto.learnerFileResponse ||
      requestDto.learnerFileResponse.length === 0
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedFileResponse",
          requestDto.language,
        ),
      );
    }

    // // Validate file count if required
    // if (question.fileConfig?.maxFiles && requestDto.learnerFileResponse.length > question.fileConfig.maxFiles) {
    //   throw new BadRequestException(
    //     this.localizationService.getLocalizedString(
    //       "tooManyFiles",
    //       requestDto.language,
    //       { maxFiles: question.fileConfig.maxFiles }
    //     )
    //   );
    // }

    // // Validate file types if required
    // if (question.fileConfig?.allowedTypes && question.fileConfig.allowedTypes.length > 0) {
    //   const allowedTypes = new Set(question.fileConfig.allowedTypes);
    //   const invalidFiles = requestDto.learnerFileResponse.filter(file => {
    //     const fileExtension = file.fileName.split('.').pop().toLowerCase();
    //     return !allowedTypes.has(fileExtension);
    //   });

    //   if (invalidFiles.length > 0) {
    //     throw new BadRequestException(
    //       this.localizationService.getLocalizedString(
    //         "invalidFileTypes",
    //         requestDto.language,
    //         {
    //           allowedTypes: question.fileConfig.allowedTypes.join(', '),
    //           invalidFiles: invalidFiles.map(f => f.fileName).join(', ')
    //         }
    //       )
    //     );
    //   }
    // }

    // // Validate file size if required
    // if (question.fileConfig?.maxSizeKb) {
    //   const oversizedFiles = requestDto.learnerFileResponse.filter(file => {
    //     // Size is usually in bytes, convert to KB
    //     return (file.fileSize / 1024) > question.fileConfig.maxSizeKb;
    //   });

    //   if (oversizedFiles.length > 0) {
    //     throw new BadRequestException(
    //       this.localizationService.getLocalizedString(
    //         "fileTooLarge",
    //         requestDto.language,
    //         {
    //           maxSize: question.fileConfig.maxSizeKb,
    //           oversizedFiles: oversizedFiles.map(f => f.fileName).join(', ')
    //         }
    //       )
    //     );
    //   }
    // }

    return true;
  }

  /**
   * Extract the file response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<LearnerFileUpload[]> {
    return requestDto.learnerFileResponse;
  }

  /**
   * Grade the file response using LLM
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: LearnerFileUpload[],
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Pre-process files if needed based on file type
    // This could include parsing CSV/Excel files, extracting text from PDFs, etc.
    const processedFiles = await this.preprocessFiles(learnerResponse);

    // Create evaluation model for the LLM
    const fileUploadQuestionEvaluateModel = new FileUploadQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext,
      context.assignmentInstructions,
      processedFiles,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.type,
      question.responseType ?? "OTHER",
    );

    // Use LLM to grade the response
    const gradingModel = await this.llmFacadeService.gradeFileBasedQuestion(
      fileUploadQuestionEvaluateModel,
      context.assignmentId,
      context.language,
    );

    // Create and populate response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    // Add file-specific metadata to the response
    responseDto.metadata = {
      ...responseDto.metadata,
      fileCount: learnerResponse.length,
      fileTypes: [
        ...new Set(
          learnerResponse.map((file) =>
            file.filename.split(".").pop().toLowerCase(),
          ),
        ),
      ],
    };

    return responseDto;
  }

  /**
   * Pre-process files based on their type to extract relevant content for grading
   */
  private async preprocessFiles(
    files: LearnerFileUpload[],
  ): Promise<LearnerFileUpload[]> {
    return files.map((file) => {
      // Add preprocessing metadata
      return {
        ...file,
        preprocessed: true,
        contentSummary: this.summarizeFileContent(file),
      };
    });
  }

  /**
   * Generate a summary of file content for easier grading
   */
  private summarizeFileContent(file: LearnerFileUpload): string {
    const fileExtension = file.filename.split(".").pop().toLowerCase();

    // This is just a placeholder implementation
    switch (fileExtension) {
      case "pdf": {
        return `PDF document: ${file.filename}`;
      }
      case "csv":
      case "xlsx":
      case "xls": {
        return `Spreadsheet data: ${file.filename}`;
      }
      case "jpg":
      case "png":
      case "gif": {
        return `Image file: ${file.filename}`;
      }
      case "docx":
      case "doc": {
        return `Word document: ${file.filename}`;
      }
      case "txt": {
        return `Text file: ${file.filename}`;
      }
      default: {
        return `File: ${file.filename}`;
      }
    }
  }
}
