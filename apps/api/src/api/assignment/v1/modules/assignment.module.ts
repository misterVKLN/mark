// assignment.module.ts
import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";

// Controllers
import { QuestionController } from "../../question/question.controller";

// External modules
import { LlmModule } from "../../../llm/llm.module";
import { QuestionService } from "../../question/question.service";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { AssignmentControllerV1 } from "../controllers/assignment.controller";
import { AssignmentServiceV1 } from "../services/assignment.service";
import { AttemptControllerV1 } from "../../attempt/attempt.controller";
import { AttemptServiceV1 } from "../../attempt/attempt.service";

@Module({
  controllers: [
    AssignmentControllerV1,
    QuestionController,
    AttemptControllerV1,
  ],
  providers: [
    // Services
    AssignmentServiceV1,
    QuestionService,
    JobStatusServiceV1,
    AttemptServiceV1,
  ],
  imports: [HttpModule, LlmModule],
  exports: [QuestionService, JobStatusServiceV1],
})
export class AssignmentModuleV1 {}
