import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";

// Controllers
import { AssignmentControllerV2 } from "../controllers/assignment.controller";

// Services
import { QuestionService } from "../services/question.service";
import { AssignmentServiceV2 } from "../services/assignment.service";
import { JobStatusServiceV2 } from "../services/job-status.service";
import { ReportService } from "../services/report.repository";

// Repositories
import { AssignmentRepository } from "../repositories/assignment.repository";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";

// External modules
import { LlmModule } from "src/api/llm/llm.module";
import { PrismaService } from "src/prisma.service";

@Module({
  controllers: [AssignmentControllerV2],
  providers: [
    // Services
    AssignmentServiceV2,
    QuestionService,
    ReportService,
    JobStatusServiceV2,

    // Repositories
    AssignmentRepository,
    QuestionRepository,
    VariantRepository,

    // Core services
    PrismaService,
  ],
  imports: [HttpModule, LlmModule],
  exports: [AssignmentServiceV2, QuestionService, JobStatusServiceV2],
})
export class AssignmentModuleV2 {}
