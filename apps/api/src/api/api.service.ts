import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

@Injectable()
export class ApiService {
  private logger: Logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ApiService.name });
  }
  rootV1(): Record<string, string | number> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    this.logger.info("showing api version information");

    return {
      version: 1,
    };
  }

  rootV2(): string {
    return "Not Yet Implemented";
  }
}
